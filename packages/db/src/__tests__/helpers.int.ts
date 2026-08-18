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

/**
 * The suffix a database must carry before this file will drop its schema.
 *
 * `resetSchema` is destructive and takes whatever URL it is given; the
 * `NODE_ENV=production` refusal lives in `src/reset.ts`'s CLI `main()`, which
 * this path does not go through. A root `.env` where `DATABASE_URL_TEST` was
 * copy-pasted from `DATABASE_URL` — the likeliest way to get this wrong —
 * would otherwise drop the developer's dev schema on `pnpm test:int`.
 */
const testDatabaseSuffix = "_test";

/** Drops schemas `public` and `drizzle`, then replays every migration onto the empty result. */
export const migrateFreshTestDatabase = async (): Promise<DbClient> => {
  const url = readTestDatabaseUrl();
  const database = new URL(url).pathname.replace(/^\//, "");

  if (!database.endsWith(testDatabaseSuffix)) {
    throw new Error(
      `Refusing to reset "${database}": DATABASE_URL_TEST must point at a database whose name ends in "${testDatabaseSuffix}" (ADR-0007 creates machxi_test for exactly this).`,
    );
  }

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
