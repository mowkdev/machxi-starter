import type { Logger } from "@repo/logger";
import type { Store } from "express-rate-limit";
import { Redis } from "ioredis";
import { RedisStore } from "rate-limit-redis";

/**
 * The rate limiters' shared store (ADR-0066 §4, a delta on ADR-0020).
 *
 * The limits themselves do not move: the windows, the maxima and the
 * `IP` / `IP + email` / staff-principal keys are exactly what ADR-0020 and
 * ADR-0057 §1 decided. What this file settles is **where the counter lives** —
 * in this process, as it always has, or in Redis, so that N instances stop
 * meaning N times every budget.
 *
 * One store, built once and handed to all four limiters, is the point: a
 * per-limiter choice is a choice one limiter can be left out of.
 */

/** What `express-rate-limit` uses when no store is supplied: its memory store. */
export type RateLimitStore = Store | undefined;

/**
 * A store **per limiter**, named — never one instance shared by four.
 *
 * `rate-limit-redis` keys on `prefix + key` and nothing else, and three of the
 * four limiters key on the address alone, so a single prefix would make the
 * global limiter and the refresh limiter read and write the same counter: five
 * ordinary `/api/v1` requests would exhaust an address's refresh budget, and
 * the refresh limiter's `skipSuccessfulRequests` would *decrement* the global
 * one. `express-rate-limit` detects the reuse (`ERR_ERL_STORE_REUSE`) and only
 * logs it, so the breakage is silent — and it would appear **only** on the
 * Redis path, i.e. only in the multi-instance deployment this seam exists for.
 *
 * The name is the counter's namespace. Callers pass a literal at the
 * composition root, so no two limiters can be given the same one by accident.
 * (`D14.6`'s `security-reviewer`.)
 */
export type RateLimitStoreFactory = (limiter: string) => RateLimitStore;

export interface RateLimitStoreHandle {
  /**
   * Builds the store for one named limiter. Returns `undefined` throughout
   * when there is no Redis, which is `express-rate-limit`'s "use my in-memory
   * store" — and an in-memory store is per limiter instance already, which is
   * why the collision above is a Redis-only bug.
   */
  readonly store: RateLimitStoreFactory;
  /** Closes the client, if there is one. Chained into the server's shutdown. */
  readonly close: () => Promise<void>;
}

/**
 * The little of a Redis client this file uses.
 *
 * Stated as a structural type so the selection can be unit-tested without a
 * server (ADR-0021): what the test asserts is *which* store gets built, which
 * is the decision — not that Redis speaks Redis.
 */
export interface RateLimitRedisClient {
  readonly connect: () => Promise<unknown>;
  readonly quit: () => Promise<unknown>;
  readonly call: (...args: string[]) => Promise<unknown>;
  readonly on: (event: "error", listener: (error: unknown) => void) => unknown;
}

export interface CreateRateLimitStoreDeps {
  /** `REDIS_URL`, absent when the deployment runs one instance. */
  readonly url: string | undefined;
  readonly logger: Logger;
  /** Injected by the unit test; the default wraps ioredis. */
  readonly connect?: (url: string) => RateLimitRedisClient;
}

/**
 * ioredis, with the two options that make "fail closed" true.
 *
 * `lazyConnect` so the connection is opened by an awaited `connect()` in
 * `main.ts` rather than in a constructor whose failure nobody is holding, and
 * `enableOfflineQueue: false` so a command issued while the client is down
 * **rejects** instead of queueing: a queued command would hold the request
 * open until the client came back, which is a worse failure than refusing it.
 * A rejected store operation is what `passOnStoreError: false` turns into a
 * refusal (ADR-0066 §4) — a configured Redis that is unreachable stops traffic
 * rather than silently removing every limit.
 */
const defaultConnect = (url: string): RateLimitRedisClient =>
  new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });

export const createRateLimitStore = async ({
  url,
  logger,
  connect = defaultConnect,
}: CreateRateLimitStoreDeps): Promise<RateLimitStoreHandle> => {
  if (url === undefined) {
    logger.info(
      { store: "memory" },
      "rate limiting uses the in-memory store; every limit counts per process",
    );

    return { store: () => undefined, close: () => Promise.resolve() };
  }

  const client = connect(url);

  // Registered before `connect`, because an unhandled `error` on an
  // EventEmitter takes the process down — and a reconnect attempt after a
  // blip is exactly when one arrives. It only logs: whether traffic is
  // refused meanwhile is the limiter's decision, made above.
  client.on("error", (error: unknown) => {
    logger.error({ err: error, store: "redis" }, "rate-limit store error");
  });

  await client.connect();

  logger.info({ store: "redis" }, "rate limiting uses a shared Redis store");

  const sendCommand = (...args: string[]): Promise<never> =>
    client.call(...args) as Promise<never>;

  return {
    // `RedisStore` is a third-party constructor, wrapped here rather than
    // reached for at each limiter (ADR-0009) — and built **per limiter**, over
    // one shared connection, so each budget has its own key space.
    store: (limiter: string) =>
      new RedisStore({ prefix: `rl:${limiter}:`, sendCommand }),
    close: async (): Promise<void> => {
      await client.quit();
    },
  };
};
