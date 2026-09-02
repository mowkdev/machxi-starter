import { lt, or } from "drizzle-orm";

import { createDb, type DbExecutor } from "./client.js";
import { impersonationHandoffs, sessions } from "./schema/index.js";
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
 * **Two tables since `D13.4`** (ADR-0057 §2, which decides that "the
 * `db:sessions:prune` sweep grows their deletion"): `impersonation_handoffs`
 * holds the one-time tokens a mint issues, and a consumed or expired row is
 * inert the moment it stops being redeemable. The command keeps its name — the
 * job is "delete the credential rows nothing can use any more", and a spent
 * handoff is one — and reports the two counts separately, so an operator
 * reading the line can see which table grew.
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

/**
 * Deletes handoffs that expired, or were consumed, before `cutoff`
 * (ADR-0057 §2).
 *
 * The same cutoff the sessions sweep uses, deliberately: retention has one
 * rule in this file, and a second constant would be a second decision nobody
 * made. A handoff is redeemable for `IMPERSONATION_HANDOFF_TTL` — 60 seconds
 * by default — so `RETENTION_DAYS` here is entirely audit-trail grace, which
 * is the same reason a revoked session is kept rather than dropped at the
 * moment it dies.
 *
 * A row that is neither consumed nor past its expiry is **never** touched: it
 * may still be redeemed, and deleting it would break an impersonation somebody
 * is halfway through starting. The `expires_at` index (`D13.3`) is what makes
 * the first half of the predicate a scan of the dead rows rather than of the
 * table.
 *
 * @returns how many rows were deleted.
 */
export const pruneImpersonationHandoffs = async (
  db: DbExecutor,
  cutoff: Date,
): Promise<number> => {
  const deleted = await db
    .delete(impersonationHandoffs)
    .where(
      or(
        lt(impersonationHandoffs.expiresAt, cutoff),
        lt(impersonationHandoffs.consumedAt, cutoff),
      ),
    )
    .returning({ id: impersonationHandoffs.id });

  return deleted.length;
};

const main = async (): Promise<void> => {
  // The **application** role, alone among this package's CLI entry points
  // (ADR-0061 §1): this one runs no DDL — two `delete … where expired`
  // statements — and running it as the owner would mean a scheduled job
  // holding a connection that can drop tables. The privileges it needs are
  // exactly the ones the API already has.
  const url = readDatabaseUrl();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400 * 1000);

  writeLine(
    `db:sessions:prune → ${describeTarget(url)} (NODE_ENV=${readNodeEnv()}, cutoff ${cutoff.toISOString()})`,
  );

  const client = createDb(url, {
    max: 1,
    idleTimeout: 5,
    applicationName: "machxi-prune",
  });

  try {
    // `vacuum` is left to autovacuum; a delete of a few thousand rows does not
    // justify an exclusive lock on the table an API is authenticating against.
    const deleted = await pruneSessions(client.db, cutoff);
    const handoffs = await pruneImpersonationHandoffs(client.db, cutoff);

    writeLine(
      `db:sessions:prune ✓ ${String(deleted)} session(s) and ${String(handoffs)} handoff(s) removed`,
    );
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
