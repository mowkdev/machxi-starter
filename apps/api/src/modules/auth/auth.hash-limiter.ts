import { unavailable } from "../../core/errors/index.js";

/**
 * A cap on argon2 hashes running at once (ADR-0020 §Hashing cost vs. liveness).
 *
 * Password hashing is the only work this API does that is expensive in a way
 * the event loop cannot see: `argon2` runs on a libuv thread and holds it, plus
 * 64 MiB, for ~130 ms. Node's default pool is four threads and it is shared
 * with DNS, `fs` and zlib — so a burst of logins does not merely slow logins
 * down, it stalls unrelated work **process-wide**, including the readiness
 * probe that would otherwise take the instance out of rotation.
 *
 * The rate limiters in ADR-0020 bound one client; they do not bound the sum of
 * all clients. This does, by admitting `maxConcurrent` hashes and queueing the
 * rest. The queue is bounded too: an unbounded one converts a CPU limit into a
 * memory limit and answers every waiter long after its client gave up. Past
 * that bound the request is shed with `503` and a `Retry-After`, which is the
 * honest answer — the server is at capacity, and it will be again in a second.
 */

/** Waiting slots per concurrent slot, when the caller does not say otherwise. */
export const DEFAULT_QUEUE_FACTOR = 8;

/** Seconds a shed caller is asked to wait. One hash is ~130 ms; a queue drains fast. */
const RETRY_AFTER_SECONDS = 1;

export interface HashLimiterOptions {
  /** Hashes admitted at once; `AUTH_MAX_CONCURRENT_HASHES` (ADR-0004). */
  readonly maxConcurrent: number;
  /** Waiters admitted before shedding. Defaults to `maxConcurrent * 8`. */
  readonly maxQueued?: number;
}

export const createHashLimiter = ({
  maxConcurrent,
  maxQueued = maxConcurrent * DEFAULT_QUEUE_FACTOR,
}: HashLimiterOptions) => {
  if (maxConcurrent < 1) {
    throw new RangeError("createHashLimiter: maxConcurrent must be at least 1");
  }

  let active = 0;
  const waiting: (() => void)[] = [];

  const release = (): void => {
    const next = waiting.shift();

    if (next === undefined) {
      active -= 1;

      return;
    }

    // The slot passes straight to the next waiter instead of being released
    // and re-taken: decrementing first would let a request that arrives in
    // between overtake the whole queue.
    next();
  };

  const acquire = async (): Promise<void> => {
    if (active < maxConcurrent) {
      active += 1;

      return;
    }

    if (waiting.length >= maxQueued) {
      throw unavailable([
        { code: "retryAfter", message: String(RETRY_AFTER_SECONDS) },
      ]);
    }

    await new Promise<void>((resolve) => {
      waiting.push(resolve);
    });
  };

  return {
    /**
     * Runs `work` once a slot is free.
     *
     * @throws AppError `SERVICE_UNAVAILABLE` when the queue is full.
     */
    run: async <T>(work: () => Promise<T>): Promise<T> => {
      await acquire();

      try {
        return await work();
      } finally {
        release();
      }
    },

    /** Observability for tests and a future metric; never a control decision. */
    stats: (): { active: number; queued: number } => ({
      active,
      queued: waiting.length,
    }),
  } as const;
};

export type HashLimiter = ReturnType<typeof createHashLimiter>;
