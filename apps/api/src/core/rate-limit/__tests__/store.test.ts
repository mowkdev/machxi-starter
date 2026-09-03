import { createLogger } from "@repo/logger";
import { describe, expect, it, vi } from "vitest";

import { createRateLimitStore, type RateLimitRedisClient } from "../index.js";

/**
 * ADR-0066 §4: one store, chosen once, handed to all four limiters.
 *
 * The assertion is the **selection**, not Redis: whether a deployment's
 * counters live in this process or in a shared server is the decision, and it
 * is made by the presence of `REDIS_URL` and by nothing else.
 */

const logger = createLogger({ level: "silent" });

const fakeClient = () => {
  const client = {
    connect: vi.fn(() => Promise.resolve()),
    quit: vi.fn(() => Promise.resolve()),
    call: vi.fn(() => Promise.resolve(1)),
    on: vi.fn(),
  };

  return client satisfies RateLimitRedisClient;
};

describe("createRateLimitStore", () => {
  it("uses the in-memory store when REDIS_URL is unset", async () => {
    const connect = vi.fn(fakeClient);

    const handle = await createRateLimitStore({
      url: undefined,
      logger,
      connect,
    });

    // `undefined` is the answer, not a missing one: `express-rate-limit` reads
    // it as "use my memory store", which is correct for one instance.
    expect(handle.store("global")).toBeUndefined();
    expect(handle.store("refresh")).toBeUndefined();
    expect(connect).not.toHaveBeenCalled();

    await expect(handle.close()).resolves.toBeUndefined();
  });

  it("uses a Redis store when REDIS_URL is set", async () => {
    const client = fakeClient();
    const connect = vi.fn(() => client);

    const handle = await createRateLimitStore({
      url: "redis://localhost:6379",
      logger,
      connect,
    });

    expect(connect).toHaveBeenCalledWith("redis://localhost:6379");
    // `prefix` is `RedisStore`'s own field; a memory store has none.
    expect(handle.store("global")).toHaveProperty("prefix", "rl:global:");
    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it("gives each limiter its own key space over one connection", () => {
    // `rate-limit-redis` keys on `prefix + key`, and the global, refresh and
    // login limiters all key on the address — so one shared instance would
    // merge their counters, and the refresh limiter's `skipSuccessfulRequests`
    // would *decrement* the global one. `express-rate-limit` notices the reuse
    // and only logs it, so the collision would be silent and Redis-only.
    const connect = () => fakeClient();

    return createRateLimitStore({
      url: "redis://localhost:6379",
      logger,
      connect,
    }).then((handle) => {
      const prefixes = ["global", "login", "refresh", "impersonation"].map(
        (name) => (handle.store(name) as { prefix: string }).prefix,
      );

      expect(new Set(prefixes).size).toBe(prefixes.length);
      expect(prefixes).toEqual([
        "rl:global:",
        "rl:login:",
        "rl:refresh:",
        "rl:impersonation:",
      ]);
    });
  });

  it("registers an error listener before connecting", async () => {
    const client = fakeClient();
    let listenerRegisteredFirst = false;

    client.connect.mockImplementation(() => {
      listenerRegisteredFirst = client.on.mock.calls.length > 0;

      return Promise.resolve();
    });

    await createRateLimitStore({
      url: "redis://localhost:6379",
      logger,
      connect: () => client,
    });

    // An unhandled `error` on an EventEmitter takes the process down, and a
    // failing connect is exactly when one arrives.
    expect(listenerRegisteredFirst).toBe(true);
    expect(client.on).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("closes the client on shutdown", async () => {
    const client = fakeClient();

    const handle = await createRateLimitStore({
      url: "redis://localhost:6379",
      logger,
      connect: () => client,
    });

    await handle.close();

    expect(client.quit).toHaveBeenCalledTimes(1);
  });
});
