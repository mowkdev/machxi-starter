import { runMigrations } from "./migrate.js";
import { resetSchema } from "./reset.js";
import { isProduction } from "./tooling/env.js";

/**
 * Test-database helpers (ADR-0021).
 *
 * Exported as `@repo/db/testing` so the API's integration `globalSetup` builds
 * its database through the same reset-and-replay path this package's own
 * suite uses, instead of a second copy that can drift from the committed
 * migrations.
 *
 * Deliberately a separate entry point: it is destructive, and nothing that
 * imports `@repo/db` should be able to reach it by accident.
 */

/**
 * The suffix a database must carry before this module will drop its schema.
 *
 * `resetSchema` takes whatever URL it is given, and the `NODE_ENV=production`
 * refusal lives in the `db:reset` CLI wrapper, which this path does not go
 * through. A `DATABASE_URL_TEST` copy-pasted from `DATABASE_URL` — the
 * likeliest way to get this wrong — would otherwise drop the developer's dev
 * schema on `pnpm test:int` (ADR-0008 §Environment guardrails).
 */
export const TEST_DATABASE_SUFFIX = "_test";

/** Throws unless `url` names a database whose name ends in `_test`. */
export const assertTestDatabase = (url: string): void => {
  const database = new URL(url).pathname.replace(/^\//, "");

  if (!database.endsWith(TEST_DATABASE_SUFFIX)) {
    throw new Error(
      `Refusing to reset "${database}": the test database URL must name a database ending in "${TEST_DATABASE_SUFFIX}" (ADR-0007 creates machxi_test for exactly this).`,
    );
  }
};

/**
 * Drops schemas `public` and `drizzle`, then replays every committed migration
 * onto the empty result.
 */
export const migrateFreshDatabase = async (url: string): Promise<void> => {
  // Both guards, not one. The suffix check is the primary one, but this entry
  // point exists to be called from a test harness whose URL comes from the
  // environment, and the `NODE_ENV` refusal it routes around (`db:reset`'s CLI
  // wrapper has it) is one line and fails for a different reason — a database
  // called `app_test` on a production host passes the suffix check.
  if (isProduction()) {
    throw new Error(
      "migrateFreshDatabase drops every table and refuses to run when NODE_ENV=production.",
    );
  }

  assertTestDatabase(url);

  await resetSchema(url);
  await runMigrations(url);
};
