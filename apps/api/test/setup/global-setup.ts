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
 */
export default async function setup(): Promise<void> {
  const { databaseUrl } = loadTestEnv();

  await migrateFreshDatabase(databaseUrl);
}
