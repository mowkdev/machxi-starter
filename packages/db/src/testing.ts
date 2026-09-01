import { sql as raw } from "drizzle-orm";

import type { DbExecutor } from "./client.js";
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

/**
 * Every table an integration test may write, in one list.
 *
 * Named explicitly rather than discovered from `information_schema`: a
 * discovered list would also truncate `__drizzle_migrations` the moment
 * someone changed the schema Drizzle keeps it in, and rebuilding the journal
 * is a `migrateFreshDatabase` away — but only if the suite notices, and it
 * would not.
 */
export const TRUNCATED_TABLES = [
  "sessions",
  // Foreign-key-free too (ADR-0057 §2), so `cascade` never reaches it either:
  // a handoff row minted by one integration file would otherwise still be
  // consumable in the next.
  "impersonation_handoffs",
  // The one table `cascade` can never reach: `audit_events` carries no foreign
  // key by decision (ADR-0058), so nothing sweeps it as a side effect and a
  // row written by one integration file would otherwise be counted by the
  // next.
  "audit_events",
  "staff_roles",
  "user_roles",
  // Named although `cascade` on `staff` and `users` already empties them
  // (ADR-0045 gives each settings table a real foreign key): this list is
  // read as "every application table", and a table that is only cleaned as a
  // side effect of another one's constraint is a leak waiting for the day
  // that constraint changes.
  "staff_settings",
  "user_settings",
  "staff",
  "users",
] as const;

/**
 * Empties every application table (ADR-0021).
 *
 * Used between integration files so fixtures one test mutates cannot leak into
 * the next. One statement with `cascade`, so declaration order does not
 * matter, and `restart identity` for the day a sequence appears — every id
 * today is an app-generated UUIDv7 (ADR-0006).
 *
 * It does **not** re-run migrations: the schema is built once per run by
 * {@link migrateFreshDatabase}, and rebuilding it per file would cost seconds
 * for no isolation a truncate does not already give.
 */
export const truncateAll = async (db: DbExecutor): Promise<void> => {
  // The same refusal `migrateFreshDatabase` carries, for the same reason: this
  // is exported from a package entry point and takes an *executor*, so it
  // deletes every row of whatever database it is handed — there is no URL here
  // to apply the `_test`-suffix rule to (ADR-0008 §Environment guardrails).
  if (isProduction()) {
    throw new Error(
      "truncateAll deletes every row and refuses to run when NODE_ENV=production.",
    );
  }

  await db.execute(
    raw`truncate table ${raw.raw(TRUNCATED_TABLES.join(", "))} restart identity cascade`,
  );
};
