import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createDb } from "./client.js";
import {
  migrationsFolder,
  readOwnerDatabaseUrl,
  readTestOwnerDatabaseUrl,
} from "./tooling/env.js";
import { isEntryPoint } from "./tooling/entrypoint.js";
import { describeTarget, writeErrorLine, writeLine } from "./tooling/report.js";

/**
 * Applies pending migrations (ADR-0008).
 *
 * Programmatic `migrate()` rather than `drizzle-kit push`: the committed SQL in
 * `migrations/` is the reviewed artefact, and `push` diffs the live database
 * against the schema instead of replaying it. Drizzle's `__drizzle_migrations`
 * table is the applied-state record.
 *
 * **Concurrent runs serialize on an advisory lock** (ADR-0059 §5, `D14.3`).
 * Drizzle's pg dialect wraps the pending statements in one transaction but
 * takes no lock of its own, so two deploy jobs starting together would both
 * read the same last-applied row and both replay `0002` — the second failing
 * on whatever it re-creates. `pg_advisory_lock` makes the second job wait for
 * the first instead, which is what this comment claimed from D1 and what the
 * release step in `docker/prod/compose.yaml` depends on.
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
 * not `pg_advisory_xact_lock`) because Drizzle opens the transaction itself —
 * there is no transaction here to attach one to — and because the lock has to
 * cover the journal read that decides *which* migrations to apply, which
 * happens before that transaction starts.
 */
export const MIGRATION_LOCK_KEY = 728_042_119;

export const runMigrations = async (url: string): Promise<void> => {
  writeLine(`db:migrate → ${describeTarget(url)}`);

  // max: 1 — `migrate()` runs its statements on one connection and the process
  // exits straight after; a pool would only add connections to close. It is
  // also what makes the lock below mean anything: a session-level lock is held
  // by the connection that took it, and with a pool the migration could run on
  // a different one.
  //
  // `idleTimeout: 0` for the same reason. postgres.js closes an idle
  // connection after the timeout and transparently opens a new one for the
  // next query — and the lock would die with the old one, silently, leaving
  // exactly the race this function closes. `close()` below is what lets the
  // process exit; the idle timeout was never doing that job.
  //
  // `statementTimeoutMs: 0` because a migration is a long statement by nature
  // — an index build on a populated table is the ordinary case — and the
  // API-shaped default (ADR-0061 §3) would cancel one halfway, leaving the
  // journal and the schema disagreeing. The advisory lock, not a timeout, is
  // what bounds this run against another.
  //
  // `onNotice` because a migration is the one place a server notice carries
  // something an operator has to act on: a `GRANT` that only partly applies
  // commits with a `WARNING` rather than an error (ADR-0061 §1), and the
  // default handler in `createDb` discards it. Migration `0008` also asserts
  // its own post-condition, so this is the explanation rather than the guard.
  const client = createDb(url, {
    max: 1,
    idleTimeout: 0,
    statementTimeoutMs: 0,
    applicationName: "machxi-migrate",
    onNotice: (notice) => {
      writeLine(`  postgres: ${notice.message ?? "(no message)"}`);
    },
  });

  try {
    // Blocks until whatever holds it releases. No timeout on purpose: the
    // thing being waited for is another release job applying the same
    // migrations, and giving up early is exactly the race this closes.
    await client.sql`select pg_advisory_lock(${MIGRATION_LOCK_KEY}::bigint)`;

    try {
      await migrate(client.db, { migrationsFolder });
      writeLine("db:migrate ✓ up to date");
    } finally {
      // Swallowed, and only here: a throw from `finally` replaces the
      // rejection it is unwinding, so an unlock that fails because the
      // connection died would report itself instead of the migration error
      // that killed it. Closing the connection releases the lock anyway.
      await client.sql`select pg_advisory_unlock(${MIGRATION_LOCK_KEY}::bigint)`.catch(
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
