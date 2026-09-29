import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq, sql as raw } from "drizzle-orm";
import { migrate as drizzleMigrate } from "drizzle-orm/postgres-js/migrator";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { createDb, type DbClient } from "../client.js";
import { users } from "../index.js";
import {
  CONCURRENT_MARKER,
  MIGRATION_LOCK_KEY,
  runMigrations,
} from "../migrate.js";
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
 * A migration is applied when it is recorded, not when it is newer
 * (ADR-0078 §1, `D29.1`).
 *
 * Drizzle's `migrate()` compares each journal entry's timestamp with the
 * newest applied row and applies only what is later. A fork that has applied
 * a migration of its own and then merges an older one from the starter would
 * have it skipped, silently. These cases build that journal in a copy of the
 * committed folder — the committed files are never touched — and run the
 * runner against it.
 */
describe("the runner applies by hash", () => {
  interface Journal {
    entries: {
      idx: number;
      version: string;
      when: number;
      tag: string;
      breakpoints: boolean;
    }[];
  }

  let folder: string;

  const readJournal = (): Journal =>
    JSON.parse(
      readFileSync(join(folder, "meta", "_journal.json"), "utf8"),
    ) as Journal;

  /** Appends a file to the copied journal, stamped `when`. */
  const addMigration = (tag: string, when: number, sqlText: string): void => {
    const journal = readJournal();

    journal.entries.push({
      idx: journal.entries.length,
      version: "7",
      when,
      tag,
      breakpoints: true,
    });
    writeFileSync(
      join(folder, "meta", "_journal.json"),
      JSON.stringify(journal, null, 2),
    );
    writeFileSync(join(folder, `${tag}.sql`), sqlText);
  };

  const appliedCount = async (): Promise<number> => {
    const rows = await client.db.execute<{ count: string }>(
      raw`select count(*)::text as count from drizzle.__drizzle_migrations`,
    );

    return Number(rows[0]?.count);
  };

  const relationExists = async (name: string): Promise<boolean> => {
    const rows = await client.db.execute<{ found: string | null }>(
      raw`select to_regclass(${name})::text as found`,
    );

    return typeof rows[0]?.found === "string";
  };

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "machxi-migrations-"));
    cpSync(migrationsFolder, folder, { recursive: true });
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  afterAll(async () => {
    // What the next describe expects: the committed schema, fully migrated,
    // and nothing these cases added.
    await resetSchema(url);
    await runMigrations(url);
  });

  it("an entry older than the newest applied one is still applied", async () => {
    await resetSchema(url);
    await runMigrations(url);

    // Older than every entry but the first: the timestamp a starter migration
    // merged into a fork carries when the fork's own are newer. Drizzle's
    // runner compares it with the newest row and skips it.
    const [, second] = readJournal().entries;

    addMigration(
      "9000_merged_from_the_starter",
      (second?.when ?? 0) - 1,
      "CREATE TABLE merged_probe (id integer);",
    );

    const before = await appliedCount();

    await runMigrations(url, { migrationsFolder: folder });

    expect(await relationExists("merged_probe")).toBe(true);
    expect(await appliedCount()).toBe(before + 1);

    // And once only: the second run finds it recorded.
    await runMigrations(url, { migrationsFolder: folder });
    expect(await appliedCount()).toBe(before + 1);
  });

  it("a database migrated by drizzle has nothing pending", async () => {
    // Every database deployed before this runner: Drizzle's own loop over the
    // committed folder, as the release step ran it until now.
    await resetSchema(url);

    const drizzleClient = createDb(url, {
      max: 1,
      idleTimeout: 2,
      statementTimeoutMs: 0,
    });

    try {
      await drizzleMigrate(drizzleClient.db, { migrationsFolder });
    } finally {
      await drizzleClient.close();
    }

    const before = await appliedCount();

    expect(before).toBe(journalEntryCount());

    // Resolving is itself the assertion: replaying `0001` onto a database that
    // has it fails on the first `CREATE TABLE`.
    await runMigrations(url);
    expect(await appliedCount()).toBe(before);

    // A row whose hash is no committed file's — a CRLF checkout, or a file
    // edited before it was committed, both found in a live table — still
    // counts, by the journal timestamp Drizzle wrote beside it.
    await client.db.execute(
      raw`update drizzle.__drizzle_migrations set hash = 'crlf-' || hash`,
    );
    await runMigrations(url);
    expect(await appliedCount()).toBe(before);
  });

  it("a row whose timestamp is not the journal's still counts by its hash", async () => {
    await resetSchema(url);
    await runMigrations(url);

    const before = await appliedCount();

    // Every recorded timestamp moved off the journal's, so only the hash can
    // say these files are applied. Replaying `0001` would fail on its first
    // `CREATE TABLE`.
    await client.db.execute(
      raw`update drizzle.__drizzle_migrations set created_at = created_at + 1`,
    );
    await runMigrations(url);
    expect(await appliedCount()).toBe(before);
  });

  it("a concurrent-lane file is recorded only when its last statement succeeds", async () => {
    await resetSchema(url);
    await runMigrations(url);

    const tag = "9001_concurrent_probe";
    const when = Date.now();
    // Repeatable, as the second lane requires: a failed concurrent build
    // leaves an invalid index behind, so the file drops before it creates.
    const file = (last: string): string =>
      [
        CONCURRENT_MARKER,
        "DROP INDEX CONCURRENTLY IF EXISTS users_concurrent_probe_idx;",
        "--> statement-breakpoint",
        "CREATE INDEX CONCURRENTLY users_concurrent_probe_idx ON users (created_at);",
        "--> statement-breakpoint",
        last,
      ].join("\n");

    addMigration(tag, when, file("SELECT 1 / 0;"));

    const before = await appliedCount();

    await expect(
      runMigrations(url, { migrationsFolder: folder }),
    ).rejects.toThrow();

    // The index was built: it ran outside a transaction — inside one,
    // Postgres refuses `CONCURRENTLY` outright — and nothing rolled it back.
    expect(await relationExists("users_concurrent_probe_idx")).toBe(true);
    // And the file is not recorded, so the next run starts it again.
    expect(await appliedCount()).toBe(before);

    writeFileSync(join(folder, `${tag}.sql`), file("SELECT 1;"));
    await runMigrations(url, { migrationsFolder: folder });

    expect(await relationExists("users_concurrent_probe_idx")).toBe(true);
    expect(await appliedCount()).toBe(before + 1);

    const recorded = await client.db.execute<{ created_at: string }>(
      raw`select created_at::text as created_at from drizzle.__drizzle_migrations where created_at = ${when}`,
    );

    expect(recorded).toHaveLength(1);
  });

  it("two runs over a concurrent-lane file serialise without a deadlock", async () => {
    await resetSchema(url);
    await runMigrations(url);

    // A backend blocked inside `pg_advisory_lock` holds a snapshot while it
    // waits, and `CREATE INDEX CONCURRENTLY` waits for every older snapshot
    // before it finishes — each run would wait on the other. The waiter polls
    // instead, holding nothing between tries.
    addMigration(
      "9002_concurrent_race",
      Date.now(),
      [
        CONCURRENT_MARKER,
        "DROP INDEX CONCURRENTLY IF EXISTS users_concurrent_race_idx;",
        "--> statement-breakpoint",
        "CREATE INDEX CONCURRENTLY users_concurrent_race_idx ON users (updated_at);",
      ].join("\n"),
    );

    const before = await appliedCount();

    await Promise.all([
      runMigrations(url, { migrationsFolder: folder }),
      runMigrations(url, { migrationsFolder: folder }),
    ]);

    expect(await relationExists("users_concurrent_race_idx")).toBe(true);
    expect(await appliedCount()).toBe(before + 1);
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
