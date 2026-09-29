import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type postgres from "postgres";

import { createDb, type DbClient } from "./client.js";
import {
  migrationsFolder as defaultMigrationsFolder,
  readOwnerDatabaseUrl,
  readTestOwnerDatabaseUrl,
} from "./tooling/env.js";
import { isEntryPoint } from "./tooling/entrypoint.js";
import { describeTarget, writeErrorLine, writeLine } from "./tooling/report.js";

/**
 * Applies pending migrations (ADR-0008, as carried by ADR-0078 §1).
 *
 * **A migration is applied when it is recorded, not when it is newer.**
 * Drizzle's `migrate()` reads the newest row of its table and applies a
 * journal entry only when the entry's timestamp is later; the hash it stores
 * is never compared. A fork that has applied a migration of its own and then
 * merges an older one from the starter would skip it silently. This loop
 * replaces it: every journal entry that the applied-state table does not
 * record is applied, in journal order, and recorded.
 *
 * The table is Drizzle's — `drizzle.__drizzle_migrations (id, hash,
 * created_at)` — read and written as it stands, so a database Drizzle migrated
 * needs no change. An entry counts as recorded when a row carries its **hash**
 * or its **journal timestamp** (`created_at`, which Drizzle and this runner
 * both write as the entry's `when`). The timestamp is there because hashes
 * already in deployed tables are not all hashes of the committed files: a
 * file hashed under a CRLF checkout, or edited before it was committed,
 * recorded bytes nobody can reproduce, and a hash-only rule would replay it.
 *
 * **Two lanes** (ADR-0078 §1). The ordinary lane runs a pending run of files in
 * one transaction, as Drizzle did. A file whose first line is
 * {@link CONCURRENT_MARKER} runs in the second lane: each statement on its
 * own, outside any transaction, recorded only when the last one succeeds — for
 * `CREATE INDEX CONCURRENTLY` and `VALIDATE CONSTRAINT`, which a transaction
 * refuses or holds a lock through. Such a file's statements are written to be
 * repeatable, because a failure part-way leaves it unrecorded and the next run
 * starts it again.
 *
 * Not `drizzle-kit push`: the committed SQL in `migrations/` is the reviewed
 * artefact, and `push` diffs the live database against the schema instead of
 * replaying it.
 *
 * **Concurrent runs serialize on an advisory lock** (ADR-0059 §5). Two deploy
 * jobs starting together would both read the same applied rows and both
 * replay the same file — the second failing on whatever it re-creates.
 * `pg_advisory_lock` makes the second job wait for the first instead, which is
 * what the release step in `docker/prod/compose.yaml` depends on.
 *
 * **The API never calls this** — migrating is an explicit deploy step, not a
 * boot step, so startup stays deterministic across replicas (ADR-0008).
 *
 * **It connects as the owner role** (ADR-0061 §1). DDL is the owner's; the
 * application role the API uses holds table privileges and nothing else, so
 * `DATABASE_URL` cannot apply a migration and is not read here.
 *
 *   pnpm db:migrate            # DATABASE_URL_OWNER
 *   pnpm db:migrate --test     # DATABASE_URL_TEST_OWNER
 *   node dist/migrate.js       # the bundled entry, inside the API image
 */

/**
 * The advisory-lock key this repository's migrations serialize on.
 *
 * An arbitrary but **fixed** 64-bit integer: advisory locks share one
 * namespace per database, so the only property that matters is that every
 * migrate run picks the same number and nothing else in the deployment picks
 * it too. Session-scoped rather than transaction-scoped (`pg_advisory_lock`,
 * not `pg_advisory_xact_lock`) because the lock has to cover the read that
 * decides *which* migrations to apply, and the second lane's statements, none
 * of which run inside a transaction.
 */
export const MIGRATION_LOCK_KEY = 728_042_119;

/**
 * The first line that puts a migration file in the second lane (ADR-0078 §1).
 *
 * In the file rather than in the journal: `drizzle-kit generate` rewrites
 * `_journal.json` and would drop a field it does not know, while a
 * `--custom` migration's SQL is the author's.
 */
export const CONCURRENT_MARKER = "-- migrate:concurrently";

/**
 * How long a run waiting for the lock sleeps between tries, in milliseconds.
 *
 * Polled with `pg_try_advisory_lock` rather than blocked in
 * `pg_advisory_lock`: a backend blocked inside a statement holds a snapshot
 * while it waits, and `CREATE INDEX CONCURRENTLY` waits for every older
 * snapshot before it finishes — so a second-lane file run by one release job
 * and a second job queued on the lock would each wait on the other until
 * Postgres aborted one as a deadlock. Between tries the waiter holds nothing.
 */
const LOCK_POLL_MS = 500;

/** Drizzle's separator between the statements of one migration file. */
const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

/** One journal entry, read from disk and ready to apply. */
export interface Migration {
  readonly tag: string;
  /** The journal's `when`, written to `created_at` when it is recorded. */
  readonly when: number;
  /** SHA-256 over the file with its line endings normalised to LF. */
  readonly hash: string;
  readonly statements: readonly string[];
  readonly concurrent: boolean;
}

/** One row of the applied-state table. */
export interface AppliedRow {
  readonly hash: string;
  readonly createdAt: number | null;
}

interface JournalEntry {
  readonly tag: string;
  readonly when: number;
}

/**
 * Reads the journal and every file it names, in journal order.
 *
 * The file is hashed **with LF line endings** whatever the checkout wrote:
 * `.gitattributes` pins the directory to LF, and the normalisation is what
 * keeps a hash stable on a machine where that pin was not yet in force. The
 * committed bytes are LF, so the hash is Drizzle's own for every file.
 */
export const readMigrations = (folder: string): Migration[] => {
  const journal = JSON.parse(
    readFileSync(join(folder, "meta", "_journal.json"), "utf8"),
  ) as { entries: JournalEntry[] };

  return journal.entries.map((entry) => {
    const text = readFileSync(join(folder, `${entry.tag}.sql`), "utf8").replace(
      /\r\n/g,
      "\n",
    );

    return {
      tag: entry.tag,
      when: entry.when,
      hash: createHash("sha256").update(text).digest("hex"),
      statements: text
        .split(STATEMENT_BREAKPOINT)
        .filter((statement) => statement.trim() !== ""),
      concurrent: text.split("\n", 1)[0]?.trim() === CONCURRENT_MARKER,
    };
  });
};

/**
 * The entries no applied row records, in journal order — by hash or by
 * journal timestamp, never by comparison with the newest row.
 */
export const pendingMigrations = (
  migrations: readonly Migration[],
  applied: readonly AppliedRow[],
): Migration[] => {
  const hashes = new Set(applied.map((row) => row.hash));
  const timestamps = new Set(applied.map((row) => row.createdAt));

  return migrations.filter(
    (migration) =>
      !hashes.has(migration.hash) && !timestamps.has(migration.when),
  );
};

type Sql = DbClient["sql"];

const record = async (
  sql: postgres.ISql,
  migration: Migration,
): Promise<void> => {
  await sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${migration.hash}, ${migration.when})`;
};

/**
 * Applies `batch` — consecutive ordinary-lane files — in one transaction, each
 * statement through the simple protocol, as Drizzle's runner did.
 */
const applyInTransaction = async (
  sql: Sql,
  batch: readonly Migration[],
): Promise<void> => {
  await sql.begin(async (tx) => {
    for (const migration of batch) {
      for (const statement of migration.statements) {
        await tx.unsafe(statement);
      }

      await record(tx, migration);
    }
  });

  for (const migration of batch) {
    writeLine(`  applied ${migration.tag}`);
  }
};

/**
 * Applies one second-lane file: every statement on its own, outside a
 * transaction, and the row written only once the last has succeeded.
 */
const applyConcurrently = async (
  sql: Sql,
  migration: Migration,
): Promise<void> => {
  for (const statement of migration.statements) {
    await sql.unsafe(statement);
  }

  await record(sql, migration);
  writeLine(`  applied ${migration.tag} (outside a transaction)`);
};

export interface RunMigrationsOptions {
  /** The folder holding `meta/_journal.json`; the package's own by default. */
  readonly migrationsFolder?: string;
}

export const runMigrations = async (
  url: string,
  options: RunMigrationsOptions = {},
): Promise<void> => {
  const { migrationsFolder = defaultMigrationsFolder } = options;

  writeLine(`db:migrate → ${describeTarget(url)}`);

  // Read before connecting: a missing file is a packaging fault, and it should
  // say so without a database in the way.
  const migrations = readMigrations(migrationsFolder);

  // max: 1 — the lock below is held by the connection that took it, so every
  // statement has to run on that one connection; a pool could hand a
  // migration to another.
  //
  // `idleTimeout: 0` for the same reason. postgres.js closes an idle
  // connection after the timeout and transparently opens a new one for the
  // next query — and the lock would die with the old one, silently, leaving
  // exactly the race this function closes.
  //
  // `statementTimeoutMs: 0` because a migration is a long statement by nature
  // — an index build on a populated table is the ordinary case — and the
  // API-shaped default (ADR-0061 §3) would cancel one halfway. The advisory
  // lock, not a timeout, is what bounds this run against another.
  //
  // `maxLifetime: 0` for the same reason again: postgres.js retires a
  // connection after 30 to 60 minutes by default, and a run that long — an
  // index built concurrently on a large table — would lose its lock with it.
  //
  // `onNotice` because a migration is the one place a server notice carries
  // something an operator has to act on: a `GRANT` that only partly applies
  // commits with a `WARNING` rather than an error (ADR-0061 §1).
  const client = createDb(url, {
    max: 1,
    idleTimeout: 0,
    maxLifetime: 0,
    statementTimeoutMs: 0,
    applicationName: "machxi-migrate",
    onNotice: (notice) => {
      writeLine(`  postgres: ${notice.message ?? "(no message)"}`);
    },
  });
  const { sql } = client;

  try {
    // Waits until whatever holds it releases. No timeout on purpose: the
    // thing being waited for is another release job applying the same
    // migrations, and giving up early is exactly the race this closes.
    // Polled, not blocking — `LOCK_POLL_MS` says why.
    for (;;) {
      const [attempt] = await sql<{ locked: boolean }[]>`
        select pg_try_advisory_lock(${MIGRATION_LOCK_KEY}::bigint) as locked
      `;

      if (attempt?.locked === true) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }

    try {
      // Drizzle's own DDL for its table, so a database either runner created
      // reads the same to the other.
      await sql`create schema if not exists drizzle`;
      await sql`create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`;

      const rows = await sql<{ hash: string; created_at: string | null }[]>`
        select hash, created_at from drizzle.__drizzle_migrations
      `;
      const pending = pendingMigrations(
        migrations,
        rows.map((row) => ({
          hash: row.hash,
          createdAt: row.created_at === null ? null : Number(row.created_at),
        })),
      );

      // Consecutive ordinary files share a transaction; a second-lane file
      // commits what precedes it, then runs on its own.
      let batch: Migration[] = [];

      for (const migration of pending) {
        if (!migration.concurrent) {
          batch.push(migration);
          continue;
        }

        if (batch.length > 0) {
          await applyInTransaction(sql, batch);
          batch = [];
        }

        await applyConcurrently(sql, migration);
      }

      if (batch.length > 0) {
        await applyInTransaction(sql, batch);
      }

      writeLine(
        pending.length === 0
          ? "db:migrate ✓ up to date"
          : `db:migrate ✓ applied ${pending.length}, up to date`,
      );
    } finally {
      // Swallowed, and only here: a throw from `finally` replaces the
      // rejection it is unwinding, so an unlock that fails because the
      // connection died would report itself instead of the migration error
      // that killed it. Closing the connection releases the lock anyway.
      await sql`select pg_advisory_unlock(${MIGRATION_LOCK_KEY}::bigint)`.catch(
        () => undefined,
      );
    }
  } finally {
    // Belt and braces: closing the connection releases a session-level lock
    // even if the unlock above never ran.
    await client.close();
  }
};

if (isEntryPoint(import.meta.url)) {
  const useTestDatabase = process.argv.slice(2).includes("--test");

  try {
    await runMigrations(
      useTestDatabase ? readTestOwnerDatabaseUrl() : readOwnerDatabaseUrl(),
    );
  } catch (error) {
    // The message, not the stack, for the reason `seeds/run.ts` gives: a
    // connection error from postgres.js can carry the connection string, and
    // an unhandled rejection would print exactly that.
    writeErrorLine(
      `db:migrate ✗ ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
