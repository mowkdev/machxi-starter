import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createDb } from "./client.js";
import {
  migrationsFolder,
  readDatabaseUrl,
  readTestDatabaseUrl,
} from "./tooling/env.js";
import { isEntryPoint } from "./tooling/entrypoint.js";
import { describeTarget, writeErrorLine, writeLine } from "./tooling/report.js";

/**
 * Applies pending migrations (ADR-0008).
 *
 * Programmatic `migrate()` rather than `drizzle-kit push`: the committed SQL in
 * `migrations/` is the reviewed artefact, and `push` diffs the live database
 * against the schema instead of replaying it. Drizzle's `__drizzle_migrations`
 * table is the applied-state record, and `migrate()` takes an advisory lock, so
 * two deploy jobs starting at once do not both apply `0002`.
 *
 * **The API never calls this** — migrating is an explicit deploy step, not a
 * boot step, so startup stays deterministic across replicas (ADR-0008).
 *
 *   pnpm db:migrate            # DATABASE_URL
 *   pnpm db:migrate --test     # DATABASE_URL_TEST
 */
export const runMigrations = async (url: string): Promise<void> => {
  writeLine(`db:migrate → ${describeTarget(url)}`);

  // max: 1 — `migrate()` runs its statements on one connection and the process
  // exits straight after; a pool would only add connections to close.
  const client = createDb(url, { max: 1, idleTimeout: 5 });

  try {
    await migrate(client.db, { migrationsFolder });
    writeLine("db:migrate ✓ up to date");
  } finally {
    await client.close();
  }
};

if (isEntryPoint(import.meta.url)) {
  const useTestDatabase = process.argv.slice(2).includes("--test");

  try {
    await runMigrations(
      useTestDatabase ? readTestDatabaseUrl() : readDatabaseUrl(),
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
