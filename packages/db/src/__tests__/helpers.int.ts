import { createArgon2Hasher } from "@repo/crypto";

import { createDb, type DbClient } from "../client.js";
import { migrateFreshDatabase } from "../testing.js";
import { readTestDatabaseUrl } from "../tooling/env.js";

/**
 * Shared setup for the integration suite (ADR-0021).
 *
 * Points at `DATABASE_URL_TEST` — the `machxi_test` database created by the
 * compose init script (ADR-0007) — and rebuilds it from the committed
 * migrations, so what these tests exercise is the same path `pnpm db:setup`
 * takes. Requires `pnpm docker:up`.
 *
 * The reset itself, and the `_test`-suffix refusal that guards it, live in
 * `src/testing.ts` (`@repo/db/testing`) because the API's integration suite
 * needs exactly the same thing (step 7). This package predates
 * `apps/api/.env.test` and follows the root `.env` (ADR-0004).
 */
export const migrateFreshTestDatabase = async (): Promise<DbClient> => {
  const url = readTestDatabaseUrl();

  await migrateFreshDatabase(url);

  return createDb(url, { max: 2, idleTimeout: 2 });
};

/**
 * argon2 at the lowest parameters the library accepts. The suite hashes on
 * every seeder run, and the algorithm's cost is `@repo/crypto`'s to test, not
 * this package's — production parameters would add seconds per run for no
 * additional coverage.
 */
export const testHasher = () =>
  createArgon2Hasher({
    memoryKib: 8192,
    timeCost: 1,
    parallelism: 1,
    allowWeakParams: true,
  });
