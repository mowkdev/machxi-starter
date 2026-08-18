import type { PasswordHasher } from "@repo/crypto";

/**
 * Password hashing with the process-wide concurrency cap already applied
 * (ADR-0020 §Hashing cost vs. liveness).
 *
 * The cap exists because argon2 holds a libuv thread and 64 MiB for ~130 ms,
 * and the pool is shared with DNS, `fs` and the readiness probe. Every service
 * that hashes or verifies a password must go through it — which is precisely
 * why they are handed *this* and not the raw {@link PasswordHasher}: a service
 * that never holds the unlimited form cannot bypass the cap by forgetting to
 * wrap a call.
 *
 * It lives in `core/` and takes the limiter **structurally** rather than
 * importing `HashLimiter` from `modules/auth`: `core` importing a module would
 * invert the dependency direction ADR-0009 exists to fix, and structural
 * typing means the auth module's limiter satisfies this without either file
 * knowing about the other.
 */

/** Anything that admits `work` when it has capacity — the auth module's `HashLimiter`. */
export interface ConcurrencyLimiter {
  readonly run: <T>(work: () => Promise<T>) => Promise<T>;
}

/**
 * The subset of {@link PasswordHasher} a feature service needs.
 *
 * `needsRehash` and `dummyHash` are deliberately absent: transparent parameter
 * upgrades and the unknown-email timing defence are login concerns, and login
 * lives in the auth module (ADR-0018).
 */
export interface LimitedHasher {
  readonly hash: (password: string) => Promise<string>;
  readonly verify: (digest: string, password: string) => Promise<boolean>;
}

export interface CreateLimitedHasherDeps {
  readonly hasher: PasswordHasher;
  readonly limiter: ConcurrencyLimiter;
}

export const createLimitedHasher = ({
  hasher,
  limiter,
}: CreateLimitedHasherDeps): LimitedHasher => ({
  hash: (password) => limiter.run(() => hasher.hash(password)),
  verify: (digest, password) =>
    limiter.run(() => hasher.verify(digest, password)),
});
