import { sql as raw } from "drizzle-orm";
import {
  getTableConfig,
  type PgColumn,
  type PgTable,
} from "drizzle-orm/pg-core";

import { createDb, type DbExecutor } from "./client.js";
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
 *
 * **Takes the owner's URL** (ADR-0061 §1) — `DATABASE_URL_TEST_OWNER`. Both
 * halves are DDL, and the application role the suite itself runs as has none;
 * that split is the point, because it means every query a test makes carries
 * exactly the privileges production has.
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
 * Empties every application table (ADR-0021), **on an owner executor**.
 *
 * `TRUNCATE` is not in the application role's grant (ADR-0061 §1 grants
 * `SELECT, INSERT, UPDATE, DELETE`), and it is deliberately not added: a
 * row-level `BEFORE UPDATE OR DELETE` trigger never fires for a truncate, so
 * `TRUNCATE` is the one door §2's pair cannot close and the application role
 * must not hold the key to it. Emptying the database between files is harness
 * work, not suite work — {@link truncateAllWithOwner} is what a harness calls.
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

/**
 * Opens an owner connection, {@link truncateAll}s through it, and closes it.
 *
 * What every integration harness calls between files (ADR-0061 §1). The
 * connection is short-lived on purpose: a harness has no teardown hook to
 * close a long-lived one from, and a per-file connect costs a millisecond
 * against a truncate that costs more.
 *
 * The URL is the **owner's** (`DATABASE_URL_TEST_OWNER`), for the reason
 * {@link truncateAll} gives: the application role has no `TRUNCATE`, and
 * granting it would open the one door the append-only trigger cannot.
 */
export const truncateAllWithOwner = async (ownerUrl: string): Promise<void> => {
  // The `_test`-suffix refusal, which the executor-taking form above cannot
  // apply because it has no URL to look at (ADR-0008 §Environment guardrails).
  // Here there is one, so it is checked.
  assertTestDatabase(ownerUrl);

  const client = createDb(ownerUrl, {
    max: 1,
    idleTimeout: 2,
    applicationName: "machxi-test-harness",
  });

  try {
    await truncateAll(client.db);
  } finally {
    await client.close();
  }
};

/**
 * What an allow-list needs on the other side: which columns the table declares
 * an index for, and of which kind (ADR-0060 §3).
 *
 * Three kinds, because the three allow-lists need three different things.
 *
 * A **sortable** column needs a btree index it *leads* and whose coverage is
 * the whole table: the pagination key is `(column, id)`, only an index's first
 * column orders by that column, and a **partial** index orders only the rows
 * its predicate admits — `users_email_active_unique` is `where deleted_at is
 * null`, so it cannot order a list that includes deleted accounts, which is
 * exactly what `filter[deletedAt][null]=false` asks for.
 *
 * A **filterable** column is happy with a partial index, because a filter can
 * imply the predicate: `deleted_at is not null` is served by an index built on
 * exactly those rows, and a full index on a column that is null almost
 * everywhere would be a copy of the table for nothing.
 *
 * A **searched** column needs a GIN index, because `ilike '%term%'` reads no
 * btree at all.
 */
export interface IndexCoverage {
  /** Columns a **complete** btree index — or a unique constraint — leads with. */
  readonly ordered: ReadonlySet<string>;
  /** Columns any btree index leads with, partial ones included. */
  readonly filtered: ReadonlySet<string>;
  /** Columns a GIN index covers. */
  readonly searched: ReadonlySet<string>;
}

/**
 * Reads a table's index declarations into the three sets above.
 *
 * A **column-level `.unique()`** counts as complete coverage: Postgres builds
 * a unique btree index for it, and a column constraint cannot be partial.
 * That is why `staff.email` needs no index of its own while `users.email`
 * does — the latter's uniqueness is the partial index above, and this reader
 * is what makes the distinction rather than a comment claiming it.
 *
 * This reports what the schema **declares**, not what a planner would choose.
 * ADR-0060 §3 asked for a set comparison naming the columns that claim an
 * order nothing serves, and deliberately not for a query planner in a test.
 */
export const indexCoverage = (table: PgTable): IndexCoverage => {
  const config = getTableConfig(table);
  const ordered = new Set<string>();
  const filtered = new Set<string>();
  const searched = new Set<string>();

  const addComplete = (name: string): void => {
    ordered.add(name);
    filtered.add(name);
  };

  for (const column of config.columns) {
    if (column.isUnique || column.primary) addComplete(column.name);
  }

  for (const constraint of config.uniqueConstraints) {
    const [first] = constraint.columns;

    if (first !== undefined) addComplete(first.name);
  }

  for (const index of config.indexes) {
    const [first] = index.config.columns;

    // An expression index (a bare `SQL`) has no single column to attribute,
    // and nothing in this schema declares one; if that changes, the column it
    // stands for is named explicitly rather than guessed at here.
    if (first === undefined || !("name" in first)) continue;

    const name = first.name;

    if (typeof name !== "string") continue;

    if (index.config.method === "gin") {
      searched.add(name);
      continue;
    }

    if (index.config.where === undefined) addComplete(name);
    else filtered.add(name);
  }

  return { ordered, filtered, searched };
};

/**
 * The allow-listed columns a table declares no adequate index for
 * (ADR-0060 §3).
 *
 * The rule this makes checkable rather than remembered:
 *
 * > A column enters a `sortable`, `filterable` or searchable allow-list only
 * > with its index in the same step.
 *
 * Columns are passed as the `PgColumn`s a module's own `ColumnMap` and search
 * list already hold, so the test asserts the objects the repository queries
 * with — not a second list of names that could drift from them.
 *
 * @returns the offending column names, per kind; empty means covered.
 */
export const uncoveredListColumns = (
  table: PgTable,
  claims: {
    readonly ordered?: readonly PgColumn[];
    readonly filtered?: readonly PgColumn[];
    readonly searched?: readonly PgColumn[];
  },
): {
  readonly ordered: readonly string[];
  readonly filtered: readonly string[];
  readonly searched: readonly string[];
} => {
  const coverage = indexCoverage(table);
  const missing = (
    columns: readonly PgColumn[] | undefined,
    covered: ReadonlySet<string>,
  ): string[] =>
    (columns ?? [])
      .filter((column) => !covered.has(column.name))
      .map((column) => column.name);

  return {
    ordered: missing(claims.ordered, coverage.ordered),
    filtered: missing(claims.filtered, coverage.filtered),
    searched: missing(claims.searched, coverage.searched),
  };
};
