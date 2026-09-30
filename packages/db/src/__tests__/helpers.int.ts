import { createArgon2Hasher } from "@repo/crypto";

import { createDb, type DbClient } from "../client.js";
import { migrateFreshDatabase } from "../testing.js";
import {
  readTestDatabaseUrl,
  readTestOwnerDatabaseUrl,
} from "../tooling/env.js";

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
  // The rebuild is DDL and runs as the owner (ADR-0061 §1), and so does what
  // the suite gets back (ADR-0083 §1): this tier asserts on the schema, the
  // migrations and the seeders — tooling that acts across tenants — and no
  // setting lets the application role read across them. A case that is about
  // the application role says so by opening {@link openApplicationRole}.
  const url = readTestOwnerDatabaseUrl();

  await migrateFreshDatabase(url);

  return createDb(url, { max: 2, idleTimeout: 2 });
};

/**
 * A client on the **application** role — the one the API connects as — for
 * the cases whose subject is what that role may and may not do: its grants,
 * the append-only log, the tenant policies. A test that passes on a
 * connection with more privilege than production has proves nothing about
 * production, so those cases never use the owner's pool.
 */
export const openApplicationRole = (): DbClient =>
  createDb(readTestDatabaseUrl(), { max: 2, idleTimeout: 2 });

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
