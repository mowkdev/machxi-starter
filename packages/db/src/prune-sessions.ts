import { inArray, lt, or } from "drizzle-orm";

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
 * Rows one `DELETE` may take (ADR-0060 §The session prune, batched).
 *
 * Both sweeps below used to delete every matching row in one statement and
 * `returning` each id to count them: one lock held for the whole set, and
 * every deleted id in memory. A table that has never been pruned is exactly
 * the case that breaks — the backlog is unbounded, so the transaction is too.
 *
 * A thousand is small enough that the lock is held for a moment and large
 * enough that a real backlog does not turn into ten thousand round trips.
 * Both functions take it as a parameter so a test can prove the loop rather
 * than assume it: with a batch of one, a fixture of three dead rows must still
 * leave zero behind.
 */
export const PRUNE_BATCH_SIZE = 1000;

/**
 * Runs `deleteBatch` until it reports a short batch, summing what it deleted.
 *
 * A short batch is the last one: the statement asked for `batchSize` rows and
 * the table had fewer, so there is nothing for the next pass to find and
 * asking again would cost a round trip to learn it.
 *
 * The loop is here and the statement is at each call site because a helper
 * generic enough to take either table cannot be typed: Drizzle resolves
 * `.from()`'s selection per table, and a `TTable extends PgTable` parameter
 * loses exactly that.
 */
const pruneInBatches = async (
  batchSize: number,
  deleteBatch: () => Promise<number>,
): Promise<number> => {
  // A batch of zero would make `limit 0` delete nothing and `0 < 0` false, so
  // the loop would spin forever against the database. Unreachable through the
  // CLI, which passes the constant; reachable from a test, which is exactly
  // where a hang is hardest to read.
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error(
      `prune batch size must be a positive integer, got ${String(batchSize)}`,
    );
  }

  let total = 0;

  for (;;) {
    const deleted = await deleteBatch();

    total += deleted;

    if (deleted < batchSize) return total;
  }
};

/**
 * Deletes sessions whose refresh token expired, or which were revoked, before
 * `cutoff` — in bounded batches (ADR-0060 §The session prune, batched).
 *
 * `delete … where id in (select id … limit N)`, because Postgres has no
 * `LIMIT` on a `DELETE`. The subquery is re-evaluated per batch, so a row that
 * became prunable while the loop was running is taken by a later pass rather
 * than missed, and a row another process deleted meanwhile simply stops
 * matching.
 *
 * The count is the driver's rows-affected rather than a `returning` list: the
 * point of batching is to stop holding the whole set, and returning every id
 * would put it back in memory a batch at a time for no caller.
 *
 * @returns how many rows were deleted.
 */
export const pruneSessions = async (
  db: DbExecutor,
  cutoff: Date,
  batchSize: number = PRUNE_BATCH_SIZE,
): Promise<number> => {
  // `or` widens to `SQL | undefined` only for the empty call; both arguments
  // are present here, and a `where(undefined)` would delete the table.
  const dead = or(
    lt(sessions.refreshTokenExpiresAt, cutoff),
    lt(sessions.revokedAt, cutoff),
  );

  return pruneInBatches(batchSize, async () => {
    const result = await db
      .delete(sessions)
      .where(
        inArray(
          sessions.id,
          db
            .select({ id: sessions.id })
            .from(sessions)
            .where(dead)
            .limit(batchSize),
        ),
      );

    return result.count;
  });
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
  batchSize: number = PRUNE_BATCH_SIZE,
): Promise<number> => {
  const spent = or(
    lt(impersonationHandoffs.expiresAt, cutoff),
    lt(impersonationHandoffs.consumedAt, cutoff),
  );

  return pruneInBatches(batchSize, async () => {
    const result = await db
      .delete(impersonationHandoffs)
      .where(
        inArray(
          impersonationHandoffs.id,
          db
            .select({ id: impersonationHandoffs.id })
            .from(impersonationHandoffs)
            .where(spent)
            .limit(batchSize),
        ),
      );

    return result.count;
  });
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
