import argon2 from "argon2";
import { describe, expect, it, vi } from "vitest";

import {
  createArgon2Hasher,
  defaultArgon2Params,
  minArgon2Params,
  type Argon2Params,
} from "../index.js";

/**
 * Cheap parameters so the suite stays fast; the production defaults cost
 * ~130 ms per hash. `allowWeakParams` is the deliberate escape hatch — the
 * `defaultArgon2Params` block below asserts the real values, so lowering the
 * cost here cannot hide a drift from ADR-0004.
 */
const testParams: Argon2Params = {
  memoryKib: 512,
  timeCost: 1,
  parallelism: 1,
  allowWeakParams: true,
};

const hasher = createArgon2Hasher(testParams);

describe("createArgon2Hasher", () => {
  describe("hash", () => {
    it("produces a PHC string carrying the configured argon2id parameters", async () => {
      const hash = await hasher.hash("correct horse battery staple");

      expect(hash).toMatch(/^\$argon2id\$v=19\$m=512,p=1,t=1\$/);
    });

    it("salts each hash, so equal passwords store differently", async () => {
      const [a, b] = await Promise.all([
        hasher.hash("same-password"),
        hasher.hash("same-password"),
      ]);

      expect(a).not.toBe(b);
      await expect(hasher.verify(a, "same-password")).resolves.toBe(true);
      await expect(hasher.verify(b, "same-password")).resolves.toBe(true);
    });

    it("pins the hash length and inherits argon2's 16-byte salt", async () => {
      const parts = (await hasher.hash("lengths")).split("$");

      expect(Buffer.from(parts[4] ?? "", "base64")).toHaveLength(16);
      expect(Buffer.from(parts[5] ?? "", "base64")).toHaveLength(32);
    });

    it("accepts passwords longer than bcrypt's 72-byte limit without truncating", async () => {
      const base = "x".repeat(80);
      const hash = await hasher.hash(`${base}A`);

      // bcrypt would ignore anything past byte 72 and accept both.
      await expect(hasher.verify(hash, `${base}A`)).resolves.toBe(true);
      await expect(hasher.verify(hash, `${base}B`)).resolves.toBe(false);
    });

    it("round-trips unicode passwords", async () => {
      const password = "pässwörd-Ω-ключ";
      const hash = await hasher.hash(password);

      await expect(hasher.verify(hash, password)).resolves.toBe(true);
    });
  });

  describe("parameter floor", () => {
    it("rejects parameters below the OWASP profile", () => {
      expect(() => createArgon2Hasher({ memoryKib: 8 })).toThrow(RangeError);
      expect(() => createArgon2Hasher({ timeCost: 1 })).toThrow(RangeError);
      expect(() => createArgon2Hasher({ parallelism: 0 })).toThrow(RangeError);
    });

    it("names every offending parameter", () => {
      expect(() => createArgon2Hasher({ memoryKib: 8, timeCost: 1 })).toThrow(
        /memoryKib=8 < 19456, timeCost=1 < 2/,
      );
    });

    it("accepts the floor itself and the ADR-0004 defaults", () => {
      expect(() => createArgon2Hasher(minArgon2Params)).not.toThrow();
      expect(() => createArgon2Hasher(defaultArgon2Params)).not.toThrow();
      expect(() => createArgon2Hasher()).not.toThrow();
    });

    it("only lets tests opt out", () => {
      expect(() => createArgon2Hasher({ memoryKib: 512, timeCost: 1 })).toThrow(
        RangeError,
      );
      expect(() =>
        createArgon2Hasher({
          memoryKib: 512,
          timeCost: 1,
          allowWeakParams: true,
        }),
      ).not.toThrow();
    });
  });

  describe("verify", () => {
    it("accepts the right password and rejects the wrong one", async () => {
      const hash = await hasher.hash("s3cret-password");

      await expect(hasher.verify(hash, "s3cret-password")).resolves.toBe(true);
      await expect(hasher.verify(hash, "s3cret-passwore")).resolves.toBe(false);
      await expect(hasher.verify(hash, "")).resolves.toBe(false);
    });

    it("returns false instead of throwing on a stored value that is not a digest", async () => {
      // A corrupt or foreign-algorithm row must fail the login, not 500 it.
      await expect(hasher.verify("not-a-hash", "whatever")).resolves.toBe(
        false,
      );
      await expect(hasher.verify("", "whatever")).resolves.toBe(false);
      await expect(
        hasher.verify("$2b$10$abcdefghijklmnopqrstuv", "x"),
      ).resolves.toBe(false);
      await expect(
        hasher.verify("$argon2id$truncated", "whatever"),
      ).resolves.toBe(false);
    });

    it("surfaces an operational failure rather than reporting a wrong password", async () => {
      // If argon2 itself breaks (native binding, OOM under load), swallowing it
      // would degrade every login in the deployment to a silent 401.
      const hash = await hasher.hash("operational");
      const boom = new Error("argon2: out of memory");
      const spy = vi.spyOn(argon2, "verify").mockRejectedValueOnce(boom);

      await expect(hasher.verify(hash, "operational")).rejects.toThrow(boom);

      spy.mockRestore();
    });

    it("verifies a hash produced with different parameters", async () => {
      // Parameter upgrades must not lock existing users out: the params come
      // from the stored PHC string, not from this hasher's config.
      const weak = createArgon2Hasher({
        memoryKib: 256,
        timeCost: 1,
        allowWeakParams: true,
      });
      const hash = await weak.hash("legacy-password");

      await expect(hasher.verify(hash, "legacy-password")).resolves.toBe(true);
    });
  });

  describe("needsRehash", () => {
    it("is false for a hash made with the current parameters", async () => {
      const hash = await hasher.hash("current");

      expect(hasher.needsRehash(hash)).toBe(false);
    });

    it("is true for a hash made with weaker parameters", async () => {
      const weak = createArgon2Hasher({
        memoryKib: 256,
        timeCost: 1,
        allowWeakParams: true,
      });
      const hash = await weak.hash("legacy");

      expect(hasher.needsRehash(hash)).toBe(true);
    });

    it("is true for a non-argon2id digest even at matching cost", async () => {
      // argon2.verify accepts argon2i/argon2d and argon2.needsRehash ignores
      // the algorithm, so without an explicit check an imported argon2i hash
      // would verify happily and never be upgraded to argon2id (ADR-0018).
      const argon2iHash = await argon2.hash("imported", {
        type: argon2.argon2i,
        memoryCost: 512,
        timeCost: 1,
        parallelism: 1,
        hashLength: 32,
      });

      expect(argon2iHash).toMatch(/^\$argon2i\$/);
      await expect(hasher.verify(argon2iHash, "imported")).resolves.toBe(true);
      expect(hasher.needsRehash(argon2iHash)).toBe(true);
    });

    it("is true — not a throw — for an unreadable digest", () => {
      // Mirrors `verify`'s fail-closed contract: an unusable hash should be
      // replaced, and must never 500 a caller that checks it directly.
      expect(hasher.needsRehash("not-a-hash")).toBe(true);
      expect(hasher.needsRehash("")).toBe(true);
      expect(hasher.needsRehash("$argon2id$totally-malformed")).toBe(true);
    });
  });

  describe("dummyHash", () => {
    it("is a usable argon2id hash built with the same parameters", async () => {
      const dummy = await hasher.dummyHash();

      expect(dummy).toMatch(/^\$argon2id\$v=19\$m=512,p=1,t=1\$/);
      expect(hasher.needsRehash(dummy)).toBe(false);
    });

    it("is memoised, so login pays the argon2 cost but not a second one", async () => {
      const [first, second] = await Promise.all([
        hasher.dummyHash(),
        hasher.dummyHash(),
      ]);

      expect(first).toBe(second);
    });

    it("differs per hasher and rejects every candidate password", async () => {
      const other = createArgon2Hasher(testParams);
      const dummy = await hasher.dummyHash();

      expect(await other.dummyHash()).not.toBe(dummy);
      // Equalises login timing for unknown emails without ever succeeding.
      await expect(hasher.verify(dummy, "")).resolves.toBe(false);
      await expect(hasher.verify(dummy, "password")).resolves.toBe(false);
    });

    it("does not memoise a failure, so a transient error cannot poison the process", async () => {
      // Caching a rejected promise would make every later unknown-email login
      // fail instantly — a faster, louder oracle than the one it closes.
      const fresh = createArgon2Hasher(testParams);
      const spy = vi
        .spyOn(argon2, "hash")
        .mockRejectedValueOnce(new Error("argon2: out of memory"));

      await expect(fresh.dummyHash()).rejects.toThrow("out of memory");
      spy.mockRestore();

      await expect(fresh.dummyHash()).resolves.toMatch(/^\$argon2id\$/);
    });
  });

  describe("defaultArgon2Params", () => {
    it("matches the ARGON2_* defaults in ADR-0004", () => {
      expect(defaultArgon2Params).toEqual({
        memoryKib: 65536,
        timeCost: 3,
        parallelism: 1,
      });
    });

    it("is at or above the safe floor", () => {
      expect(defaultArgon2Params.memoryKib).toBeGreaterThanOrEqual(
        minArgon2Params.memoryKib,
      );
      expect(defaultArgon2Params.timeCost).toBeGreaterThanOrEqual(
        minArgon2Params.timeCost,
      );
      expect(defaultArgon2Params.parallelism).toBeGreaterThanOrEqual(
        minArgon2Params.parallelism,
      );
    });

    it("is what an argument-less hasher uses", async () => {
      const hash = await createArgon2Hasher().hash("default-params");

      expect(hash).toMatch(/^\$argon2id\$v=19\$m=65536,p=1,t=3\$/);
    }, 20_000);

    it("fills in only the parameters the caller omitted", async () => {
      const hash = await createArgon2Hasher({ memoryKib: 20480 }).hash(
        "partial",
      );

      expect(hash).toMatch(/^\$argon2id\$v=19\$m=20480,p=1,t=3\$/);
    }, 20_000);
  });
});
