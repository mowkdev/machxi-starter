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
}

export const defaultArgon2Params = {
  memoryKib: 65536,
  timeCost: 3,
  parallelism: 1,
} as const;

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
   * Verifies a plaintext password against a stored hash. Returns `false` — it
   * does not throw — when the stored value is not a hash this algorithm can
   * read, so a corrupt row cannot turn a failed login into a 500.
   */
  verify: (hash: string, password: string) => Promise<boolean>;
  /**
   * True when `hash` was produced with weaker parameters than the ones this
   * hasher is configured with. On a successful login the caller rehashes and
   * stores the result, which upgrades cost parameters transparently.
   */
  needsRehash: (hash: string) => boolean;
  /**
   * A hash of an unguessable random password, built with these same
   * parameters. Login verifies against it when the email matches no principal
   * so that the response time does not reveal whether an account exists
   * (ADR-0018, login step 2). Computed once on first use and memoised.
   */
  dummyHash: () => Promise<string>;
}

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
  } = params;

  const options = {
    type: argon2.argon2id,
    memoryCost: memoryKib,
    timeCost,
    parallelism,
  } as const;

  const hash = (password: string): Promise<string> =>
    argon2.hash(password, options);

  let dummy: Promise<string> | undefined;

  return {
    hash,
    verify: async (storedHash: string, password: string): Promise<boolean> => {
      try {
        return await argon2.verify(storedHash, password);
      } catch {
        return false;
      }
    },
    needsRehash: (storedHash: string): boolean =>
      argon2.needsRehash(storedHash, options),
    dummyHash: (): Promise<string> => {
      // 32 random bytes: no plaintext can match it, so `verify` always fails
      // while still costing a full argon2 computation.
      dummy ??= hash(randomToken(32));
      return dummy;
    },
  } as const;
};
