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
    // would *decrement* the global one. The two mail limiters key on the same
    // address-and-email pair as each other, which is the sharpest case of all. `express-rate-limit` notices the reuse
    // and only logs it, so the collision would be silent and Redis-only.
    const connect = () => fakeClient();

    return createRateLimitStore({
      url: "redis://localhost:6379",
      logger,
      connect,
    }).then((handle) => {
      const prefixes = [
        "global",
        "login",
        "refresh",
        "impersonation",
        // The two mail limiters (`D18.2`, ADR-0071 §3–§4). They share one
        // budget by decision and must not share a *counter*, and on Redis the
        // separation is exactly these two strings differing — which is why
        // they belong in this list and not only in a memory-store test, where
        // every limiter gets its own store whatever it is called.
        "password-reset",
        "verification",
        // The mailbox limiter (`D18.5`, ADR-0071 §4). It shares its window with
        // the two above and keys on the address alone, so on Redis it is one
        // more string that must not collide with theirs.
        "mailbox",
        // The source-keyed mail limiter (`D18.7`, ADR-0071 §4). One counter
        // shared by four mounts on purpose, which is precisely why it needs a
        // string of its own here: sharing a *prefix* with any of the three
        // above would merge two different questions into one budget.
        "mail-source",
        // The reset's own argon2 counter (`D18.5`): the login limiter's
        // numbers, and it must not share the login limiter's keys.
        "password-reset-submit",
        // The two `D18.7` added beside it: the invitation lookup's budget,
        // which is the same numbers on the same source-only key, and the
        // invited mailbox's, which must not share the recovery budget for the
        // same address (ADR-0067 §5, ADR-0071 §5).
        "invitation-lookup",
        "invitation-mailbox",
      ].map((name) => (handle.store(name) as { prefix: string }).prefix);

      expect(new Set(prefixes).size).toBe(prefixes.length);
      expect(prefixes).toEqual([
        "rl:global:",
        "rl:login:",
        "rl:refresh:",
        "rl:impersonation:",
        "rl:password-reset:",
        "rl:verification:",
        "rl:mailbox:",
        "rl:mail-source:",
        "rl:password-reset-submit:",
        "rl:invitation-lookup:",
        "rl:invitation-mailbox:",
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
