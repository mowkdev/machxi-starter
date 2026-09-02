import { readFileSync } from "node:fs";
import { join } from "node:path";

import { sql as raw } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client.js";
import { MIGRATION_LOCK_KEY, runMigrations } from "../migrate.js";
import { resetSchema } from "../reset.js";
import { assertTestDatabase } from "../testing.js";
import { migrationsFolder, readTestDatabaseUrl } from "../tooling/env.js";

/**
 * The migration runner's advisory lock (ADR-0059 §5, `D14.3`).
 *
 * `migrate.ts`'s doc comment claimed from D1 that two deploy jobs starting at
 * once do not both apply the same migration. Nothing enforced it: Drizzle's pg
 * dialect wraps the pending statements in one transaction but reads the
 * journal outside any lock, so both jobs could decide `0002` was pending and
 * both replay it — the second failing on whatever it re-creates.
 *
 * `docker/prod/compose.yaml` makes that scenario ordinary rather than exotic:
 * `migrate` is the release gate the API waits on, and two releases overlapping
 * is a redeploy during a slow rollout. So the guarantee is asserted against a
 * real Postgres — an advisory lock is a property of the server, and a fake
 * cannot have one.
 */

const url = readTestDatabaseUrl();

/** How many migrations the committed journal says exist. */
const journalEntryCount = (): number => {
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
  ) as { entries: unknown[] };

  return journal.entries.length;
};

let client: DbClient;

beforeAll(() => {
  // The same guard `migrateFreshDatabase` carries, stated here because this
  // file drops schemas without going through it (ADR-0008 §Environment
  // guardrails).
  assertTestDatabase(url);

  client = createDb(url, { max: 2, idleTimeout: 2 });
});

afterAll(async () => {
  await client.close();
});

describe("runMigrations", () => {
  it("waits for a concurrent run to release the advisory lock", async () => {
    // A second connection standing in for the other release job: it holds the
    // very lock `runMigrations` takes, so the run below cannot get past it.
    const holder = createDb(url, { max: 1, idleTimeout: 2 });

    await holder.sql`select pg_advisory_lock(${MIGRATION_LOCK_KEY}::bigint)`;

    let settled = false;

    try {
      const run = runMigrations(url).then(() => {
        settled = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      // The assertion the lock exists for. Without it this run would have read
      // the journal and finished long ago — it is a no-op against an already
      // migrated database.
      expect(settled).toBe(false);

      await holder.sql`select pg_advisory_unlock(${MIGRATION_LOCK_KEY}::bigint)`;
      await run;

      expect(settled).toBe(true);
    } finally {
      await holder.close();
    }
  });

  it("applies every migration exactly once when two runs start together", async () => {
    await resetSchema(url);

    // Both against an empty database, so both would have found the same
    // migrations pending. One waits; the other finds the journal complete and
    // does nothing.
    await Promise.all([runMigrations(url), runMigrations(url)]);

    const rows = await client.db.execute<{ count: string }>(
      raw`select count(*)::text as count from drizzle.__drizzle_migrations`,
    );

    expect(Number(rows[0]?.count)).toBe(journalEntryCount());
  });

  it("releases the lock when it is done, so the next release is not blocked", async () => {
    // A leaked session-level lock would not fail this process — it would fail
    // the *next* deploy, silently, by making it hang.
    const rows = await client.db.execute<{ locked: boolean }>(
      raw`select pg_try_advisory_lock(${MIGRATION_LOCK_KEY}::bigint) as locked`,
    );

    expect(rows[0]?.locked).toBe(true);

    await client.db.execute(
      raw`select pg_advisory_unlock(${MIGRATION_LOCK_KEY}::bigint)`,
    );
  });
});
