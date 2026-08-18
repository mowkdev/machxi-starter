import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";

/**
 * Loads `apps/api/.env.test` for the integration run (ADR-0004 §File layout,
 * ADR-0021).
 *
 * Runs in **both** the `globalSetup` process and every worker: with
 * `pool: 'forks'` the workers are separate processes, and relying on them to
 * inherit whatever `globalSetup` mutated is the kind of thing that works until
 * a vitest release changes when workers are spawned.
 *
 * This is the API's only reader of `process.env` outside `core/config`, and it
 * is outside `src/` for that reason — the lint rule (ADR-0002) covers the
 * application, and the test harness is not the application.
 */

const testDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = resolve(testDir, "..", ".env.test");

let loaded = false;

/**
 * Loads the file and derives `DATABASE_URL` from `DATABASE_URL_TEST`.
 *
 * The derivation is an unconditional overwrite, and that direction is the
 * point: a developer whose shell exports `DATABASE_URL` for `psql`, or a CI
 * job that exports it for a deploy step, must not have the suite migrate and
 * truncate that database. The only URL this process can reach is the test one.
 */
export const loadTestEnv = (): { databaseUrl: string } => {
  if (!loaded) {
    // `override: true`, against dotenv's default. ADR-0004 fixes this file as
    // the winner for the test run, and what loses the race here is a
    // `DROP SCHEMA`: `globalSetup` hands the URL to `migrateFreshDatabase`, so
    // a `DATABASE_URL_TEST` exported in a shell or by a CI job would decide
    // which database gets rebuilt. A CI environment that needs a different
    // host gets its own `.env.test`, not an exported variable.
    loadDotenv({ path: envFile, quiet: true, override: true });
    loaded = true;
  }

  const databaseUrl = process.env.DATABASE_URL_TEST?.trim();

  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error(
      `DATABASE_URL_TEST is not set. It is committed in ${envFile}; run \`pnpm docker:up\` and try again (ADR-0007).`,
    );
  }

  process.env.DATABASE_URL = databaseUrl;

  return { databaseUrl };
};

loadTestEnv();
