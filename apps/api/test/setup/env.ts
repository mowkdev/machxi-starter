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

/**
 * A variable `apps/api/.env.test` commits, or a failure naming it.
 */
const read = (key: string): string => {
  const value = process.env[key]?.trim();

  if (value === undefined || value === "") {
    throw new Error(
      `${key} is not set. It is committed in ${envFile}; run \`pnpm docker:up\` and try again (ADR-0007).`,
    );
  }

  return value;
};

let loaded = false;

/**
 * Loads the file and derives `DATABASE_URL` and `DATABASE_URL_OWNER` from
 * their `_TEST` counterparts.
 *
 * The derivation is an unconditional overwrite, and that direction is the
 * point: a developer whose shell exports `DATABASE_URL` for `psql`, or a CI
 * job that exports it for a deploy step, must not have the suite migrate and
 * truncate that database. **Both** URLs this process can reach are the test
 * ones — the owner's included, since `D14.4` (ADR-0061 §1) made it a second,
 * higher-privilege credential that would otherwise arrive from the root `.env`
 * pointing at the development database.
 */
export const loadTestEnv = (): {
  databaseUrl: string;
  ownerDatabaseUrl: string;
} => {
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

  const databaseUrl = read("DATABASE_URL_TEST");
  // The owner's connection (ADR-0061 §1). Read here rather than derived from
  // the one above, because the two differ by credentials and a derivation
  // would have to know how to rewrite them — which is exactly the kind of
  // guess that ends up pointing the harness at the application role and
  // reporting "permission denied for schema public" from `globalSetup`.
  const ownerDatabaseUrl = read("DATABASE_URL_TEST_OWNER");

  process.env.DATABASE_URL = databaseUrl;
  // Both, and the second is the one that matters more since `D14.4`. Anything
  // in this process that touches `@repo/db`'s tooling loads the **root** `.env`
  // as a side effect (`process.loadEnvFile`, non-overriding — `truncateAll`'s `isProduction()`
  // check is enough to trigger it), which would leave `DATABASE_URL_OWNER`
  // pointing at the *development* database as the owner role: the highest
  // privilege credential in the repository, live in a process whose whole
  // purpose is to drop and rebuild schemas. Nothing reads it here today; this
  // line is what keeps that true if something ever does.
  process.env.DATABASE_URL_OWNER = ownerDatabaseUrl;

  // The three ADR-0066 seams a developer or a CI job might have exported for
  // something else, removed rather than overridden — there is no value for
  // them that means "off" except absence. They are declared on the `test` and
  // `test:int` tasks in `turbo.json` for the reason ADR-0026 asks: a task that
  // reads a variable declares it, and "reads it in order to delete it" is
  // still reading it.
  //
  // `REDIS_URL` would point the limiters at a shared store, so one test file's
  // counts would survive into the next run of another; `ERROR_REPORTING_DSN`
  // would send this suite's deliberate 500s to a real error tracker; and a
  // `METRICS_TOKEN` in the shell would put a bearer requirement on an endpoint
  // whose tests set their own. All three are the same failure the
  // `DATABASE_URL` overwrite above exists to prevent: the suite reaching
  // something outside itself because a shell said so.
  delete process.env.REDIS_URL;
  delete process.env.ERROR_REPORTING_DSN;
  delete process.env.METRICS_TOKEN;

  return { databaseUrl, ownerDatabaseUrl };
};

loadTestEnv();
