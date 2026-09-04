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
  // The tenant and what it owns (ADR-0067 §2). `organizations` alone would be
  // enough by cascade, and all three are named for the reason the settings
  // tables below are: this list is read as "every application table", and a
  // table cleaned only as a side effect of somebody else's constraint is a
  // leak waiting for the day that constraint changes.
  "organization_invitations",
  "organization_memberships",
  "organizations",
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
 * Every table that carries an `organization_id` (ADR-0067 §5), in one list.
 *
 * The third hand-maintained enumeration, beside `TRUNCATED_TABLES` above and
 * `RESTRICTED_SCHEMA_TABLE_IMPORTS` in `packages/config-eslint/api.js`, and
 * checked by the same test (ADR-0061 §4): every table with the column is in
 * here, negative case included.
 *
 * It exists because the property it names is one no lint rule can see. ESLint
 * can stop a table being imported outside its repository — it does — but it
 * cannot tell whether the query inside that repository carries the tenant. So
 * the list is what "unscoped is a compile error" is checked against: a
 * repository over a listed table takes the organization id as its first,
 * required parameter, and the one sanctioned exception is a read scoped by the
 * **principal** rather than by the tenant (the switcher's "which organizations
 * do I belong to", which reads `organization_memberships` by `user_id`).
 *
 * `organizations` itself is **not** here: it is the tenant, not something a
 * tenant owns, which is also why it keeps ADR-0060 §3's bare index pairs while
 * everything in this list is indexed tenant-led (ADR-0067 §1).
 */
export const TENANT_OWNED_TABLES = [
  "organization_invitations",
  "organization_memberships",
] as const;

/**
 * The tenant column, said once — as the schema **declares** it.
 *
 * `organizationId`, not `organization_id`: `getTableConfig` reports the key a
 * table was declared with, and the physical `organization_id` is produced by
 * the client's `casing: 'snake_case'` setting at query time (ADR-0006). Every
 * name {@link indexCoverage} deals in is on that side of the line, which is
 * also why a `ColumnMap` compares cleanly against it.
 *
 * What a scoped table's indexes lead with, and what a `scopedBy` claim passes
 * to {@link indexCoverage} (ADR-0067 §1).
 */
export const TENANT_SCOPE_COLUMN = "organizationId";

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
export interface IndexCoverageOptions {
  /**
   * The tenant column as the schema declares it — `"organizationId"` on every
   * table ADR-0067 §1 calls tenant-owned, `organization_id` once the client's
   * snake_case casing has been applied.
   *
   * Naming it changes **which column an index is attributed to**: on a scoped
   * table an index led by the scope covers its *second* column, because every
   * query on such a table filters by the scope first and the composite
   * `(organization_id, column, id)` is the pagination key itself. Without the
   * option a tenant-led index reads as coverage of `organizationId` and every
   * sortable column reads as uncovered — the tension ADR-0063 §3 recorded and
   * ADR-0067 §1 settles by dropping the bare pairs and teaching this reader
   * the scope.
   *
   * The scope column itself stays covered either way: an index leads with it.
   */
  readonly scopedBy?: string | undefined;
}

export const indexCoverage = (
  table: PgTable,
  options: IndexCoverageOptions = {},
): IndexCoverage => {
  const config = getTableConfig(table);
  const { scopedBy } = options;
  const ordered = new Set<string>();
  const filtered = new Set<string>();
  const searched = new Set<string>();

  const addComplete = (name: string): void => {
    ordered.add(name);
    filtered.add(name);
  };

  /**
   * Which columns a btree index over `columns` is coverage *of*.
   *
   * The leading one — and, on a scoped table whose leading column is the
   * scope, the **second** one as well. Both, not the second instead of the
   * first: `(organization_id, name, id)` orders `name` inside an organization
   * *and* still serves a filter on `organization_id`, which is what the
   * `requireMembership` lookup reads.
   */
  const attributionsOf = (names: readonly string[]): string[] => {
    const [first, second] = names;

    if (first === undefined) return [];
    if (scopedBy !== undefined && first === scopedBy && second !== undefined) {
      return [first, second];
    }

    return [first];
  };

  /**
   * The declared column names of an index or key entry, in order.
   *
   * An expression entry (a bare `SQL`) has no single column to attribute, and
   * nothing in this schema declares one; if that changes, the column it stands
   * for is named explicitly rather than guessed at here.
   */
  const namesOf = (columns: readonly unknown[]): string[] =>
    columns.flatMap((column) => {
      if (column === null || typeof column !== "object") return [];
      if (!("name" in column)) return [];

      const { name } = column as { name: unknown };

      return typeof name === "string" ? [name] : [];
    });

  for (const column of config.columns) {
    if (column.isUnique || column.primary) addComplete(column.name);
  }

  // A composite primary key is a btree index like any other, which is what
  // `organization_memberships` is ordered by: it has no surrogate id, so its
  // `(organization_id, user_id)` key is the pagination key of its members list
  // (ADR-0067 §2).
  for (const key of config.primaryKeys) {
    for (const name of attributionsOf(namesOf(key.columns))) addComplete(name);
  }

  for (const constraint of config.uniqueConstraints) {
    for (const name of attributionsOf(namesOf(constraint.columns))) {
      addComplete(name);
    }
  }

  for (const index of config.indexes) {
    const names = namesOf(index.config.columns);

    if (index.config.method === "gin") {
      // A GIN index is never composite here — `ilike '%term%'` reads one
      // column — so the scope never leads one and the attribution is the
      // leading name, scoped table or not.
      const [first] = names;

      if (first !== undefined) searched.add(first);
      continue;
    }

    for (const name of attributionsOf(names)) {
      if (index.config.where === undefined) addComplete(name);
      else filtered.add(name);
    }
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
  } & IndexCoverageOptions,
): {
  readonly ordered: readonly string[];
  readonly filtered: readonly string[];
  readonly searched: readonly string[];
} => {
  const coverage = indexCoverage(table, { scopedBy: claims.scopedBy });
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
