import { sql as raw } from "drizzle-orm";

import { createDb } from "./client.js";
import { isEntryPoint } from "./tooling/entrypoint.js";
import {
  isProduction,
  readNodeEnv,
  readOwnerDatabaseUrl,
} from "./tooling/env.js";
import { describeTarget, writeErrorLine, writeLine } from "./tooling/report.js";

/**
 * Drops and recreates the schema, discarding **everything** including the
 * migration journal, so the following `db:setup` replays the migrations from
 * scratch (ADR-0008).
 *
 * `DROP SCHEMA … CASCADE` rather than `DROP DATABASE`: the connection would
 * have to be to a different database to drop the current one, and it leaves
 * the database's owner, extensions-in-other-schemas and grants alone.
 * `CREATE EXTENSION citext` is idempotent, so migration `0000` re-runs happily.
 *
 * **Both schemas, not just `public`.** Drizzle puts `__drizzle_migrations` in
 * its own `drizzle` schema, so dropping `public` alone leaves the journal
 * claiming every migration is applied: the next `db:migrate` reports "up to
 * date" against an empty database, and the failure only surfaces at the first
 * query. ADR-0008 says "drop & recreate schema `public`" — that is the intent,
 * and this is what it takes.
 *
 * **The owner's connection** (ADR-0061 §1): dropping and creating a schema is
 * DDL, and the application role has none. The recreated `public` is owned by
 * whoever ran this, which is why migration `0008` re-grants the application
 * role its `USAGE` — a reset followed by `db:migrate` restores both.
 *
 * Local only. Refused when `NODE_ENV=production`.
 */
export const resetSchema = async (url: string): Promise<void> => {
  const client = createDb(url, {
    max: 1,
    idleTimeout: 5,
    statementTimeoutMs: 0,
    applicationName: "machxi-reset",
  });

  try {
    await client.db.execute(raw`drop schema if exists public cascade`);
    await client.db.execute(raw`drop schema if exists drizzle cascade`);
    await client.db.execute(raw`create schema public`);
  } finally {
    await client.close();
  }
};

const main = async (): Promise<void> => {
  const nodeEnv = readNodeEnv();

  if (isProduction()) {
    throw new Error(
      "db:reset drops every table and refuses to run when NODE_ENV=production.",
    );
  }

  const url = readOwnerDatabaseUrl();

  writeLine(`db:reset → ${describeTarget(url)} (NODE_ENV=${nodeEnv})`);
  await resetSchema(url);
  writeLine("db:reset ✓ schema public recreated — run db:setup to rebuild it");
};

if (isEntryPoint(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    writeErrorLine(
      `db:reset ✗ ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
