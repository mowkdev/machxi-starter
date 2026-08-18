import { describe, expect, it } from "vitest";

import {
  createArgon2Hasher,
  defaultArgon2Params,
  type Argon2Params,
} from "../index.js";

/**
 * Cheap parameters so the suite stays fast; the production defaults cost
 * ~130 ms per hash. The `defaultArgon2Params` block below asserts the real
 * ones, so lowering the cost here cannot hide a drift from ADR-0004.
 */
const testParams: Argon2Params = {
  memoryKib: 512,
  timeCost: 1,
  parallelism: 1,
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

    it("accepts passwords longer than bcrypt's 72-byte limit without truncating", async () => {
      const base = "x".repeat(80);
      const hash = await hasher.hash(`${base}A`);

      // bcrypt would ignore anything past byte 72 and accept both.
      await expect(hasher.verify(hash, `${base}A`)).resolves.toBe(true);
      await expect(hasher.verify(hash, `${base}B`)).resolves.toBe(false);
    });

    it("round-trips unicode passwords", async () => {
      const password = "pässwörd-🔐-Ω";
      const hash = await hasher.hash(password);

      await expect(hasher.verify(hash, password)).resolves.toBe(true);
    });
  });

  describe("verify", () => {
    it("accepts the right password and rejects the wrong one", async () => {
      const hash = await hasher.hash("s3cret-password");

      await expect(hasher.verify(hash, "s3cret-password")).resolves.toBe(true);
      await expect(hasher.verify(hash, "s3cret-passwore")).resolves.toBe(false);
      await expect(hasher.verify(hash, "")).resolves.toBe(false);
    });

    it("returns false instead of throwing on an unreadable stored hash", async () => {
      // A corrupt or foreign-algorithm row must fail the login, not 500 it.
      await expect(hasher.verify("not-a-hash", "whatever")).resolves.toBe(false);
      await expect(hasher.verify("", "whatever")).resolves.toBe(false);
      await expect(
        hasher.verify("$2b$10$abcdefghijklmnopqrstuv", "whatever"),
      ).resolves.toBe(false);
    });

    it("verifies a hash produced with different parameters", async () => {
      // Parameter upgrades must not lock existing users out: the params come
      // from the stored PHC string, not from this hasher's config.
      const weak = createArgon2Hasher({ memoryKib: 256, timeCost: 1 });
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
      const weak = createArgon2Hasher({ memoryKib: 256, timeCost: 1 });
      const hash = await weak.hash("legacy");

      expect(hasher.needsRehash(hash)).toBe(true);
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
  });

  describe("defaultArgon2Params", () => {
    it("matches the ARGON2_* defaults in ADR-0004", () => {
      expect(defaultArgon2Params).toEqual({
        memoryKib: 65536,
        timeCost: 3,
        parallelism: 1,
      });
    });

    it("is what an argument-less hasher uses", async () => {
      const hash = await createArgon2Hasher().hash("default-params");

      expect(hash).toMatch(/^\$argon2id\$v=19\$m=65536,p=1,t=3\$/);
    }, 20_000);

    it("fills in only the parameters the caller omitted", async () => {
      const hash = await createArgon2Hasher({ memoryKib: 512 }).hash("partial");

      expect(hash).toMatch(/^\$argon2id\$v=19\$m=512,p=1,t=3\$/);
    });
  });
});
