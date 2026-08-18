import type { PasswordHasher } from "@repo/crypto";

import type { Db } from "../src/index.js";

/**
 * What a seeder is given (ADR-0008).
 *
 * `hasher` is in the context rather than constructed per seeder because argon2
 * parameters must match what the API verifies against — one hasher, built once
 * by the runner from the `ARGON2_*` variables (ADR-0018 §Password hashing).
 */
export interface SeedContext {
  readonly db: Db;
  readonly hasher: PasswordHasher;
  readonly log: (message: string) => void;
  readonly env: {
    readonly nodeEnv: string;
    readonly superAdminEmail: string | undefined;
    readonly superAdminPassword: string | undefined;
  };
}

/**
 * A seeder is a name and a function — no base class, no registration
 * side effect (ADR-0009 applies to the whole repository, not just the API).
 *
 * **Every seeder must be idempotent by construction**: `on conflict do
 * nothing` or an upsert on a natural key, never "insert if a prior select
 * found nothing", which races. There is no journal table, so running
 * `pnpm db:seed` twice has to be a no-op the second time.
 */
export interface Seeder {
  readonly name: string;
  readonly run: (ctx: SeedContext) => Promise<void>;
}
