import { createArgon2Hasher } from "@repo/crypto";

import { createDb, type DbClient } from "../client.js";
import { runMigrations } from "../migrate.js";
import { resetSchema } from "../reset.js";
import { readTestDatabaseUrl } from "../tooling/env.js";

/**
 * Shared setup for the integration suite (ADR-0021).
 *
 * Points at `DATABASE_URL_TEST` — the `machxi_test` database created by the
 * compose init script (ADR-0007) — and rebuilds it from the committed
 * migrations, so what these tests exercise is the same path `pnpm db:setup`
 * takes. Requires `pnpm docker:up`.
 *
 * From step 7 on, the API's own integration suite reads `apps/api/.env.test`;
 * this package predates that file and follows the root `.env` (ADR-0004).
 */

/** Drops schema `public` and replays every migration onto the empty result. */
export const migrateFreshTestDatabase = async (): Promise<DbClient> => {
  const url = readTestDatabaseUrl();

  await resetSchema(url);
  await runMigrations(url);

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
