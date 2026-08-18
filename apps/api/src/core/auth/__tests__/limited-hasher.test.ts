import type { PasswordHasher } from "@repo/crypto";
import { describe, expect, it } from "vitest";

import { createHashLimiter } from "../../../modules/auth/auth.hash-limiter.js";
import { createLimitedHasher, type ConcurrencyLimiter } from "../index.js";

/**
 * ADR-0020 §Hashing cost vs. liveness, from the caller's side.
 *
 * The limiter itself is tested in `modules/auth`; what matters here is that
 * every call really goes through it, because that is the entire reason feature
 * services are handed this wrapper instead of the raw hasher.
 */

const createFakeHasher = () => {
  const calls: string[] = [];

  const hasher: PasswordHasher = {
    hash: (password) => {
      calls.push(`hash:${password}`);

      return Promise.resolve(`hashed:${password}`);
    },
    verify: (digest, password) => {
      calls.push(`verify:${password}`);

      return Promise.resolve(digest === `hashed:${password}`);
    },
    needsRehash: () => false,
    dummyHash: () => Promise.resolve("dummy"),
  };

  return { hasher, calls } as const;
};

/** Records every admission, so "did it go through the limiter?" is checkable. */
const createSpyLimiter = () => {
  let admitted = 0;

  const limiter: ConcurrencyLimiter = {
    run: async (work) => {
      admitted += 1;

      return work();
    },
  };

  return { limiter, admitted: () => admitted } as const;
};

describe("createLimitedHasher", () => {
  it("passes hashing through the limiter", async () => {
    const { hasher } = createFakeHasher();
    const spy = createSpyLimiter();
    const limited = createLimitedHasher({ hasher, limiter: spy.limiter });

    await expect(limited.hash("password")).resolves.toBe("hashed:password");
    expect(spy.admitted()).toBe(1);
  });

  it("passes verification through the limiter", async () => {
    const { hasher } = createFakeHasher();
    const spy = createSpyLimiter();
    const limited = createLimitedHasher({ hasher, limiter: spy.limiter });

    await expect(limited.verify("hashed:password", "password")).resolves.toBe(
      true,
    );
    expect(spy.admitted()).toBe(1);
  });

  it("reports a wrong password as false rather than throwing", async () => {
    const { hasher } = createFakeHasher();
    const spy = createSpyLimiter();
    const limited = createLimitedHasher({ hasher, limiter: spy.limiter });

    await expect(limited.verify("hashed:password", "wrong")).resolves.toBe(
      false,
    );
  });

  it("exposes nothing but hash and verify", async () => {
    // `needsRehash` and `dummyHash` are login concerns and stay in the auth
    // module; a feature service holding them would be holding the raw hasher
    // by another name.
    const { hasher } = createFakeHasher();
    const limited = createLimitedHasher({
      hasher,
      limiter: createSpyLimiter().limiter,
    });

    expect(Object.keys(limited).sort()).toEqual(["hash", "verify"]);
  });

  it("admits no more than the real limiter's `maxConcurrent` at once", async () => {
    // The property the wrapper exists for, against the limiter the container
    // actually builds: two slots, four callers, never three in flight.
    const limiter = createHashLimiter({ maxConcurrent: 2 });
    let inFlight = 0;
    let peak = 0;

    // Every hash parks on the same barrier, so nothing can finish until the
    // test says so and "how many started" is exactly "how many were admitted".
    let releaseAll = (): void => undefined;
    const barrier = new Promise<void>((resolve) => {
      releaseAll = resolve;
    });

    const hasher: PasswordHasher = {
      hash: async (password) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);

        await barrier;

        inFlight -= 1;

        return `hashed:${password}`;
      },
      verify: () => Promise.resolve(false),
      needsRehash: () => false,
      dummyHash: () => Promise.resolve("dummy"),
    };

    const limited = createLimitedHasher({ hasher, limiter });
    const pending = [1, 2, 3, 4].map((n) => limited.hash(`p${String(n)}`));

    await new Promise((resolve) => setImmediate(resolve));

    // Four callers, two slots: the other two are queued, not running.
    expect(peak).toBe(2);
    expect(limiter.stats()).toEqual({ active: 2, queued: 2 });

    releaseAll();
    await expect(Promise.all(pending)).resolves.toEqual([
      "hashed:p1",
      "hashed:p2",
      "hashed:p3",
      "hashed:p4",
    ]);

    // The queued pair only ever ran as the first pair finished.
    expect(peak).toBe(2);
    expect(limiter.stats()).toEqual({ active: 0, queued: 0 });
  });
});
