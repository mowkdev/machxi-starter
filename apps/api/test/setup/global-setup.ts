import { migrateFreshDatabase } from "@repo/db/testing";

import { loadTestEnv } from "./env.js";

/**
 * Rebuilds the test database once per `test:int` run (ADR-0021).
 *
 * Drops the schema and replays the committed migrations rather than trusting
 * whatever the last run left behind, so a suite that passes locally passes on a
 * clean clone — and so a migration that is wrong fails the test run instead of
 * only the deployment. The `_test`-suffix refusal lives in `@repo/db/testing`.
 *
 * Seeding is per-file from step 8 on, through the real seeders: fixtures that
 * one test mutates must not leak into the next.
 *
 * **As the owner** (ADR-0061 §1). Dropping and replaying schemas is DDL, which
 * the application role the suite itself runs as does not have — and that is
 * the property this split exists for: the tests execute with exactly the
 * privileges production has, so a grant that migration `0008` forgets fails
 * here rather than in a deployment.
 */
export default async function setup(): Promise<void> {
  const { ownerDatabaseUrl } = loadTestEnv();

  await migrateFreshDatabase(ownerDatabaseUrl);
}
