import type { DbExecutor } from "@repo/db";
import type { Logger } from "@repo/logger";

import { tryGetContext } from "../context/index.js";

/** Postgres `deadlock_detected`: this transaction was chosen as the victim. */
export const PG_DEADLOCK_DETECTED = "40P01";

/**
 * How many times a transaction is **run** before a deadlock is surfaced — the
 * first attempt and two retries (ADR-0078 §3). A victim that loses three times
 * in a row is contention a retry will not fix, and it is answered as the `500`
 * it is.
 */
export const DEFAULT_TRANSACTION_ATTEMPTS = 3;

/**
 * Whether anything in the error's `cause` chain carries SQLSTATE `40P01`.
 *
 * The chain rather than the error alone: the driver's error arrives as it is
 * from postgres.js, but Drizzle wraps a failed query in an error of its own
 * with the driver's as its `cause`, and a release of either may move which
 * one reaches the transaction's promise. Bounded, because a `cause` cycle is
 * legal JavaScript.
 */
export const isDeadlock = (error: unknown): boolean => {
  let current: unknown = error;

  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current !== "object" || current === null) return false;

    if (
      "code" in current &&
      (current as { code: unknown }).code === PG_DEADLOCK_DETECTED
    ) {
      return true;
    }

    current = "cause" in current ? (current as { cause: unknown }).cause : null;
  }

  return false;
};

export interface CreateTransactionDeps {
  /** Opens one real transaction — `db.transaction` — and nothing more. */
  readonly open: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  /** The process logger, used when a retry happens outside any request. */
  readonly logger: Logger;
  /** {@link DEFAULT_TRANSACTION_ATTEMPTS} unless a test says otherwise. */
  readonly maxAttempts?: number;
}

/**
 * The transaction helper every service is handed from the composition root
 * (ADR-0006, ADR-0078 §3): a transaction the database aborted as a deadlock
 * victim is run again from the start, a bounded number of times.
 *
 * **What makes the retry safe is a rule, not this function**: nothing inside a
 * transaction has an effect outside the database (ADR-0071's rule for mail,
 * stated for everything by ADR-0078 §3). A victim's writes were rolled back
 * whole, so running `fn` again is running it for the first time. A log line
 * written inside the aborted attempt is the one exception, and it describes an
 * attempt, which is what every log line in a transaction already does.
 *
 * Any other error — an `AppError` a service threw to roll back, a unique
 * violation, a timeout — passes through on the first attempt, untouched.
 *
 * Each retry is logged on the request's logger when there is a request, so the
 * line carries the request id; the process logger otherwise.
 */
export const createTransaction = ({
  open,
  logger,
  maxAttempts = DEFAULT_TRANSACTION_ATTEMPTS,
}: CreateTransactionDeps) => {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error(
      `maxAttempts must be a positive integer, got ${String(maxAttempts)}`,
    );
  }

  return async <T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await open(fn);
      } catch (error) {
        if (attempt >= maxAttempts || !isDeadlock(error)) throw error;

        (tryGetContext()?.logger ?? logger).warn(
          { attempt, maxAttempts, sqlState: PG_DEADLOCK_DETECTED },
          "transaction retried after a deadlock",
        );
      }
    }
  };
};
