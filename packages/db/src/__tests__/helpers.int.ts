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
  // Two roles, and the asymmetry is the point (ADR-0061 §1): the rebuild is
  // DDL and runs as the **owner**, while what the suite gets back is a client
  // on the **application** role — the one the API connects as. A test that
  // passes on a connection with more privilege than production has proves
  // nothing about production.
  await migrateFreshDatabase(readTestOwnerDatabaseUrl());

  //
  // Unscoped for the tenant policies, by name (ADR-0078 §4 as amended at
  // `D29.4`): this tier asserts on the schema, the migrations and the seeders
  // — tooling that acts across tenants — and not on the request's scope,
  // which the API's integration tier proves. `schema.int.test.ts` opens a
  // client without it for the one case that is about the scope.
  return createDb(readTestDatabaseUrl(), {
    max: 2,
    idleTimeout: 2,
    tenantUnscoped: "system",
  });
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
