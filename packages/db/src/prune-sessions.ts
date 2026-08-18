import { lt, or } from "drizzle-orm";

import { createDb, type DbExecutor } from "./client.js";
import { sessions } from "./schema/index.js";
import { isEntryPoint } from "./tooling/entrypoint.js";
import { readDatabaseUrl, readNodeEnv } from "./tooling/env.js";
import { describeTarget, writeErrorLine, writeLine } from "./tooling/report.js";

/**
 * `pnpm db:sessions:prune` — session retention (ADR-0018 §Cleanup).
 *
 * A session row stops being useful the moment its refresh token expires or it
 * is revoked, but it stays valuable for a while after that: it is the audit
 * trail that answers "which device was this, and when was it last used".
 * `RETENTION_DAYS` is that grace period, after which the row is deleted.
 *
 * A CLI rather than a scheduled job because the blueprint has no scheduler
 * yet; when one arrives it calls {@link pruneSessions} instead of shelling
 * out, which is why the query lives in a function rather than in `main`.
 *
 * Unlike `db:reset` and `db:seed --dev` this is **not** refused in production —
 * pruning is exactly what a production database needs. It can only delete rows
 * that are already unusable.
 */

/** Days a dead session is kept for the audit trail (ADR-0018 §Cleanup). */
export const RETENTION_DAYS = 30;

/**
 * Deletes sessions whose refresh token expired, or which were revoked, before
 * `cutoff`.
 *
 * @returns how many rows were deleted.
 */
export const pruneSessions = async (
  db: DbExecutor,
  cutoff: Date,
): Promise<number> => {
  const deleted = await db
    .delete(sessions)
    .where(
      or(
        lt(sessions.refreshTokenExpiresAt, cutoff),
        lt(sessions.revokedAt, cutoff),
      ),
    )
    .returning({ id: sessions.id });

  return deleted.length;
};

const main = async (): Promise<void> => {
  const url = readDatabaseUrl();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400 * 1000);

  writeLine(
    `db:sessions:prune → ${describeTarget(url)} (NODE_ENV=${readNodeEnv()}, cutoff ${cutoff.toISOString()})`,
  );

  const client = createDb(url, { max: 1, idleTimeout: 5 });

  try {
    // `vacuum` is left to autovacuum; a delete of a few thousand rows does not
    // justify an exclusive lock on the table an API is authenticating against.
    const deleted = await pruneSessions(client.db, cutoff);

    writeLine(`db:sessions:prune ✓ ${String(deleted)} session(s) removed`);
  } finally {
    await client.close();
  }
};

if (isEntryPoint(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    // The message, not the stack: a connection error from postgres.js can
    // carry the connection string.
    writeErrorLine(
      `db:sessions:prune ✗ ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
