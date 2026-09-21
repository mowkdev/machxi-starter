import type { PasswordHasher } from "@repo/crypto";
import type { DbClient } from "@repo/db";
import { baseSeeders, devSeeders, runSeeders } from "@repo/db/seeds";
import { truncateAllWithOwner } from "@repo/db/testing";

import { loadTestEnv } from "../setup/env.js";

/**
 * Per-file fixtures for the integration suite (ADR-0021).
 *
 * The accounts these tests sign in as are created by the **real seeders** —
 * the ones `pnpm db:setup` and `pnpm db:seed -- --dev` run — rather than by
 * inserts written for the tests. That is deliberate: it means the seed path is
 * exercised on every run, and a seeder that stops producing a usable account
 * fails the suite instead of only failing a developer's first login.
 *
 * Each file truncates and re-seeds in its own `beforeAll`, so a test that
 * revokes every session of the super admin cannot affect the next file
 * (`fileParallelism: false` for the integration run keeps them from
 * overlapping in time).
 */

/** The seeded super admin — `SEED_SUPER_ADMIN_*` in `apps/api/.env.test`. */
export interface SeededSuperAdmin {
  readonly email: string;
  readonly password: string;
}

/**
 * The `--dev` fixtures, mirrored from `packages/db/seeds/dev/fixtures.ts`.
 *
 * Restated here rather than imported because `seeds/dev` is not part of the
 * package's public surface, and because a test that asserts "the disabled
 * account is refused" should name the account it means.
 */
export const FIXTURE_PASSWORD = "DevPassword!123";

export const FIXTURE_STAFF = {
  manager: "manager@machxi.local",
  editor: "editor@machxi.local",
} as const;

export const FIXTURE_USERS = {
  active: "customer@machxi.local",
  pending: "pending@machxi.local",
  disabled: "disabled@machxi.local",
} as const;

/**
 * Reads a variable `apps/api/.env.test` commits (ADR-0021).
 *
 * `process.env` is legitimate here: the ADR-0004 rule covers `src/`, and the
 * test harness is not the application — these two values are read by the
 * seeder, never by the API (they are deliberately absent from `AppConfig`).
 */
const fromEnv = (key: string): string => {
  const value = process.env[key]?.trim();

  if (value === undefined || value === "") {
    throw new Error(
      `${key} is not set; it is committed in apps/api/.env.test (ADR-0021).`,
    );
  }

  return value;
};

export const superAdmin = (): SeededSuperAdmin => ({
  email: fromEnv("SEED_SUPER_ADMIN_EMAIL"),
  password: fromEnv("SEED_SUPER_ADMIN_PASSWORD"),
});

export interface ResetAndSeedOptions {
  readonly db: DbClient;
  /**
   * The harness's hasher (`TestApp.hasher`), built from the same
   * `config.auth.argon2` as the container's, so fixtures are hashed with
   * exactly the parameters the API verifies against. Building one here from
   * anything else would let the two drift and turn a config mistake into a
   * passing test.
   */
  readonly hasher: PasswordHasher;
}

/**
 * Runs the base and `--dev` seeders in order, **without** truncating first.
 *
 * Exported separately from {@link resetAndSeed} because "running it twice
 * changes nothing" is the property ADR-0008 asks for, and a truncate in
 * between would make that trivially true and prove nothing.
 */
export const seed = async ({
  db,
  hasher,
}: ResetAndSeedOptions): Promise<void> => {
  const { email, password } = superAdmin();

  await runSeeders([...baseSeeders, ...devSeeders], {
    db: db.db,
    hasher,
    env: {
      // `test`, not `production` — `selectSeeders` refuses `--dev` fixtures in
      // production, and this path bypasses that CLI guard.
      nodeEnv: "test",
      superAdminEmail: email,
      superAdminPassword: password,
    },
  });
};

/**
 * Empties every table, then seeds. What each integration file starts from.
 *
 * The truncate goes through a short-lived **owner** connection (ADR-0061 §1),
 * not through the app's `options.db`: `TRUNCATE` is not in the application
 * role's grant, and it is deliberately not added, because a row-level trigger
 * never fires for it and it is therefore the one statement that could empty
 * the append-only log. Seeding stays on the app connection — it inserts rows,
 * which is exactly what production does.
 */
export const resetAndSeed = async (
  options: ResetAndSeedOptions,
): Promise<void> => {
  await truncateAllWithOwner(loadTestEnv().ownerDatabaseUrl);
  await seed(options);
};
