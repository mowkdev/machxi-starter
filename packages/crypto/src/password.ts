import argon2 from "argon2";

import { randomToken } from "./tokens.js";

/**
 * argon2id cost parameters (ADR-0018). Defaults match the `ARGON2_*` env
 * defaults in ADR-0004, so a caller that omits them behaves exactly like one
 * that passes the unmodified config.
 */
export interface Argon2Params {
  /** Memory cost in KiB. Default 65536 (64 MiB). */
  memoryKib?: number;
  /** Number of iterations. Default 3. */
  timeCost?: number;
  /** Degree of parallelism (lanes). Default 1. */
  parallelism?: number;
  /**
   * Permits parameters below {@link minArgon2Params}. Tests only — it exists
   * so the unit suite can run at a cost that does not dominate its runtime.
   * No production call site sets it.
   */
  allowWeakParams?: boolean;
}

/** The ADR-0004 `ARGON2_*` defaults, in one place so `core/config` can reuse them. */
export const defaultArgon2Params = {
  memoryKib: 65536,
  timeCost: 3,
  parallelism: 1,
} as const;

/**
 * Lower bound accepted by {@link createArgon2Hasher} — the OWASP argon2id
 * second-choice profile (19 MiB, t=2, p=1). libargon2 itself only rejects
 * `m < 8*p` and `t < 1`, so without this floor a typo in `ARGON2_MEMORY_KIB`
 * would silently downgrade production password storage with no error. The
 * check lives here rather than only in the config schema because the seeders
 * (ADR-0008) build a hasher directly and never pass through `core/config`.
 */
export const minArgon2Params = {
  memoryKib: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Matches a structurally well-formed argon2 PHC digest. Used to tell "this
 * column does not hold a readable hash" (a data problem — fail the login)
 * apart from "argon2 itself failed" (an operational problem — must surface).
 * Parameter order is not pinned: argon2 emits `m,p,t`, other implementations
 * emit `m,t,p`.
 */
const argon2DigestPattern =
  /^\$argon2(?:id|i|d)\$v=\d+\$[a-z]+=\d+(?:,[a-z]+=\d+)*\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/;

/**
 * The password hashing port used by the API's auth service (ADR-0018) and by
 * the database seeders (ADR-0008). Both sides depend on this shape rather than
 * on `argon2` directly, so the algorithm can never diverge between them and
 * unit tests can substitute a cheap fake.
 */
export interface PasswordHasher {
  /** Hashes a plaintext password; returns a PHC-format string for storage. */
  hash: (password: string) => Promise<string>;
  /**
   * Verifies a plaintext password against a stored hash.
   *
   * Returns `false` — it does not throw — when the stored value is not a
   * readable argon2 digest, so a corrupt row fails the login instead of
   * turning it into a 500. Every other failure (native binding unavailable,
   * out of memory under load) is rethrown: swallowing those would degrade the
   * whole deployment to "wrong password" with no diagnostic signal, while
   * ADR-0020's login rate limiter locked real users out.
   */
  verify: (hash: string, password: string) => Promise<boolean>;
  /**
   * True when `hash` was not produced by argon2id, is unreadable, or used
   * weaker parameters than this hasher is configured with. On a successful
   * login the caller rehashes and stores the result, which upgrades both the
   * algorithm and the cost parameters transparently.
   */
  needsRehash: (hash: string) => boolean;
  /**
   * A hash of an unguessable random password, built with these same
   * parameters. Login verifies against it when the email matches no principal
   * so that the response time does not reveal whether an account exists
   * (ADR-0018, login step 2).
   *
   * Computed once and memoised. **Warm it during composition** — `await
   * hasher.dummyHash()` in `core/container.ts` before the server binds —
   * otherwise the first unknown-email login pays hash + verify while a
   * known-email login pays verify alone, which is exactly the timing oracle
   * this closes.
   */
  dummyHash: () => Promise<string>;
}

const assertParamFloor = (
  params: Required<Omit<Argon2Params, "allowWeakParams">>,
): void => {
  const weak = (
    [
      ["memoryKib", params.memoryKib, minArgon2Params.memoryKib],
      ["timeCost", params.timeCost, minArgon2Params.timeCost],
      ["parallelism", params.parallelism, minArgon2Params.parallelism],
    ] as const
  ).filter(([, actual, minimum]) => actual < minimum);

  if (weak.length > 0) {
    const detail = weak
      .map(
        ([name, actual, minimum]) =>
          `${name}=${String(actual)} < ${String(minimum)}`,
      )
      .join(", ");

    throw new RangeError(
      `createArgon2Hasher: parameters below the safe floor (${detail}). ` +
        `Raise them, or pass allowWeakParams: true if this is a test.`,
    );
  }
};

/**
 * Builds the argon2id hasher. `argon2.hash` embeds the salt and the parameters
 * in the returned PHC string, so `verify` and `needsRehash` need no extra
 * state beyond the stored hash itself.
 */
export const createArgon2Hasher = (
  params: Argon2Params = {},
): PasswordHasher => {
  const {
    memoryKib = defaultArgon2Params.memoryKib,
    timeCost = defaultArgon2Params.timeCost,
    parallelism = defaultArgon2Params.parallelism,
    allowWeakParams = false,
  } = params;

  if (!allowWeakParams) {
    assertParamFloor({ memoryKib, timeCost, parallelism });
  }

  // hashLength is pinned rather than inherited so a minor argon2 release
  // cannot change the stored digest format fleet-wide. The 16-byte salt is
  // not configurable in argon2 0.45 (it hardcodes `generateSalt(16)`), so a
  // unit test asserts it instead.
  const options = {
    type: argon2.argon2id,
    memoryCost: memoryKib,
    timeCost,
    parallelism,
    hashLength: 32,
  } as const;

  const hash = (password: string): Promise<string> =>
    argon2.hash(password, options);

  let dummy: Promise<string> | undefined;

  return {
    hash,
    verify: async (storedHash: string, password: string): Promise<boolean> => {
      try {
        return await argon2.verify(storedHash, password);
      } catch (error) {
        if (!argon2DigestPattern.test(storedHash)) {
          return false;
        }

        throw error;
      }
    },
    needsRehash: (storedHash: string): boolean => {
      // argon2.needsRehash compares v/m/t/p but not the algorithm, and argon2
      // .verify accepts argon2i and argon2d digests — so without this check an
      // imported non-argon2id hash would verify and never be upgraded.
      if (!storedHash.startsWith("$argon2id$")) {
        return true;
      }

      try {
        return argon2.needsRehash(storedHash, options);
      } catch {
        // Unreadable digest: it cannot be verified against anyway, so treat it
        // as needing replacement rather than throwing where `verify` would not.
        return true;
      }
    },
    dummyHash: (): Promise<string> => {
      // 32 random bytes: no plaintext can match it, so `verify` always fails
      // while still costing a full argon2 computation. A rejection is not
      // memoised — caching it would make every later unknown-email login fail
      // instantly, inverting the timing signal this exists to remove.
      dummy ??= hash(randomToken(32)).catch((error: unknown) => {
        dummy = undefined;
        throw error;
      });

      return dummy;
    },
  };
};
