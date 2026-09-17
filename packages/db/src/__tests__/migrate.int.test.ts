import { readFileSync } from "node:fs";
import { join } from "node:path";

import { eq, sql as raw } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client.js";
import { users } from "../index.js";
import { MIGRATION_LOCK_KEY, runMigrations } from "../migrate.js";
import { resetSchema } from "../reset.js";
import { assertTestDatabase } from "../testing.js";
import { migrationsFolder, readTestOwnerDatabaseUrl } from "../tooling/env.js";

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

// The owner's URL: every statement in this file is DDL or a lock taken
// around DDL, and the application role has neither (ADR-0061 §1).
const url = readTestOwnerDatabaseUrl();

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

/**
 * The `0017` migration's backfill assertion (ADR-0073 §8, `D20.5`).
 *
 * `ADD CONSTRAINT … CHECK` validates the rows that are already there, so on a
 * database holding a violating row it fails on its own. The `DO $$ … $$` block
 * above it exists to fail *differently*: with a count and an example id, so an
 * operator is sent to the rows rather than to the schema. Neither the block
 * nor the `ALTER` is exercised by the replay in `schema.int.test.ts`, which
 * only ever sees a database migrated from empty — the case this file is for is
 * the one a fork upgrading a live database will meet.
 *
 * The SQL is **read from the committed file** rather than restated, and
 * replayed inside one transaction, which is what Drizzle's runner does with a
 * migration's statements. A copy would pass while the file it stands for was
 * broken.
 */
describe("0017_users_active_email_verified_check", () => {
  const CONSTRAINT = "users_active_email_verified_check";

  const statements = (): string[] =>
    readFileSync(
      join(migrationsFolder, "0017_users_active_email_verified_check.sql"),
      "utf8",
    )
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter((statement) => statement !== "");

  /** Replays the file the way the runner would: every statement, one commit. */
  const replay = async (): Promise<void> => {
    await client.db.transaction(async (tx) => {
      for (const statement of statements()) {
        await tx.execute(raw.raw(statement));
      }
    });
  };

  const constraintExists = async (): Promise<boolean> => {
    const rows = await client.db.execute<{ conname: string }>(
      raw`select conname from pg_constraint where conname = ${CONSTRAINT}`,
    );

    return rows.length === 1;
  };

  beforeAll(async () => {
    // The database this file leaves behind is fully migrated, so the
    // constraint is already there; dropping it is what puts the tree back in
    // the state the migration meets.
    await client.db.execute(
      raw`alter table users drop constraint if exists ${raw.identifier(CONSTRAINT)}`,
    );
    await client.db.delete(users);
  });

  it("is two statements, so the split below is not a no-op", () => {
    // The guard: a mis-split would replay nothing and every assertion under it
    // would pass against a file that says anything at all.
    expect(statements()).toHaveLength(2);
  });

  it("refuses to apply while an active user has no proven address", async () => {
    await client.db.insert(users).values({
      email: "legacy-unproven@machxi.test",
      status: "active",
      emailVerifiedAt: null,
    });

    await expect(replay()).rejects.toThrow();

    /*
     * The *cause*, not the thrown message. Drizzle wraps a driver error in one
     * whose message is the failed SQL, so `rejects.toThrow(/…/)` against the
     * wrapper would match the migration's own text and pass however the
     * statement failed — the same trap `expectUniqueViolation` in
     * `schema.int.test.ts` is written around. What is asserted here is the
     * thing the `DO` block exists for: the operator is told how many rows and
     * shown one, rather than being handed Postgres's constraint name.
     */
    const error = await replay().catch((caught: unknown) => caught);
    const cause = (error as { cause?: { code?: string; message?: string } })
      .cause;

    expect(cause?.code).toBe("23514");
    expect(cause?.message).toMatch(
      /1 active user\(s\) have no email_verified_at \(for example [0-9a-f-]{36}\)/,
    );

    // And it left nothing behind: the release gate stops with the database
    // exactly as it was, and the old API still running.
    expect(await constraintExists()).toBe(false);
  });

  it("applies once the row is repaired, and holds afterwards", async () => {
    // The repair the migration's comment names, and deliberately does not
    // perform: stamping an address nobody proved would make the invariant true
    // and the claim it stands for false.
    await client.db
      .update(users)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(users.email, "legacy-unproven@machxi.test"));

    await expect(replay()).resolves.toBeUndefined();
    expect(await constraintExists()).toBe(true);

    await expect(
      client.db.insert(users).values({
        email: "after-the-fact@machxi.test",
        status: "active",
        emailVerifiedAt: null,
      }),
    ).rejects.toThrow();

    await client.db.delete(users);
  });
});
