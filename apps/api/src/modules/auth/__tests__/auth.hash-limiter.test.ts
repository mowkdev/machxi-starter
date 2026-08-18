import { describe, expect, it } from "vitest";

import { isAppError } from "../../../core/errors/index.js";
import { createHashLimiter } from "../auth.hash-limiter.js";

/**
 * ADR-0020 §Hashing cost vs. liveness. The property that matters is not "it is
 * fast" but "no more than N hashes are in flight at once, and the queue cannot
 * grow without bound".
 */

/** A promise plus the handles to settle it, so a test controls when work ends. */
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });

  return { promise, resolve };
};

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("createHashLimiter", () => {
  it("admits up to maxConcurrent at once and makes the rest wait", async () => {
    const limiter = createHashLimiter({ maxConcurrent: 2 });
    const gates = [deferred(), deferred(), deferred()];

    const runs = gates.map((gate, index) =>
      limiter.run(async () => {
        await gate.promise;

        return index;
      }),
    );

    await flush();
    expect(limiter.stats()).toEqual({ active: 2, queued: 1 });

    gates[0]?.resolve();
    await flush();

    // The freed slot went to the waiter, not back to the pool.
    expect(limiter.stats()).toEqual({ active: 2, queued: 0 });

    gates[1]?.resolve();
    gates[2]?.resolve();

    await expect(Promise.all(runs)).resolves.toEqual([0, 1, 2]);
    expect(limiter.stats()).toEqual({ active: 0, queued: 0 });
  });

  it("sheds load with 503 once the queue is full", async () => {
    // An unbounded queue turns a CPU limit into a memory limit and answers
    // waiters long after their client gave up; shedding is the honest answer.
    const limiter = createHashLimiter({ maxConcurrent: 1, maxQueued: 1 });
    const gate = deferred();

    const running = limiter.run(() => gate.promise);
    const queued = limiter.run(() => Promise.resolve());

    await flush();

    const shed = await limiter
      .run(() => Promise.resolve())
      .catch((error: unknown) => error);

    expect(isAppError(shed)).toBe(true);
    expect(shed).toMatchObject({ status: 503, code: "SERVICE_UNAVAILABLE" });
    expect(shed).toMatchObject({
      details: [{ code: "retryAfter", message: "1" }],
    });

    gate.resolve();
    await Promise.all([running, queued]);
  });

  it("releases the slot when the work throws", async () => {
    // A failed verify must not leak a permit, or the limiter converges on
    // refusing every login after enough errors.
    const limiter = createHashLimiter({ maxConcurrent: 1 });

    await expect(
      limiter.run(() => Promise.reject(new Error("argon2 exploded"))),
    ).rejects.toThrow("argon2 exploded");

    expect(limiter.stats()).toEqual({ active: 0, queued: 0 });
    await expect(limiter.run(() => Promise.resolve("ok"))).resolves.toBe("ok");
  });

  it("serves waiters in arrival order", async () => {
    const limiter = createHashLimiter({ maxConcurrent: 1 });
    const gate = deferred();
    const order: number[] = [];

    const first = limiter.run(() => gate.promise);
    const rest = [1, 2, 3].map((n) =>
      limiter.run(() => {
        order.push(n);

        return Promise.resolve();
      }),
    );

    await flush();
    gate.resolve();
    await Promise.all([first, ...rest]);

    expect(order).toEqual([1, 2, 3]);
  });

  it("refuses a nonsensical cap at construction", () => {
    expect(() => createHashLimiter({ maxConcurrent: 0 })).toThrow(RangeError);
  });
});
