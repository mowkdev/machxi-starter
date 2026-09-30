import { RESTRICTED_SCHEMA_TABLE_IMPORTS } from "@repo/eslint-config/api";
import { getTableName, is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { NEVER_PRUNED_TABLES, PRUNED_TABLES } from "../prune-sessions.js";
import * as schema from "../schema/index.js";
import {
  TENANT_OWNED_TABLES,
  TENANT_SCOPE_COLUMN,
  TRUNCATED_TABLES,
} from "../testing.js";

/**
 * The hand-maintained table enumerations, checked against the schema
 * (ADR-0061 §4, ADR-0067 §5) — three, and since `D28.4` the prune's pair.
 *
 * Neither list has a compiler behind it, and both fail **silently** when a
 * table escapes them:
 *
 *   * `RESTRICTED_SCHEMA_TABLE_IMPORTS` in `packages/config-eslint/api.js` is
 *     what keeps SQL out of services and controllers (ADR-0009) and the audit
 *     table out of everything but its writer (ADR-0058). A table missing from
 *     it is importable anywhere, and `pnpm lint` stays green.
 *   * `TRUNCATED_TABLES` in `src/testing.ts` is what empties the database
 *     between integration files (ADR-0021). A table missing from it leaks rows
 *     from one file into the next, and the suite stays green until the day two
 *     files disagree about a count.
 *   * `TENANT_OWNED_TABLES` in `src/testing.ts` is what "unscoped is a compile
 *     error" is checked against (ADR-0067 §5). A tenant table missing from it
 *     is a table nothing asks the scope of, and the leak it hides is a
 *     cross-tenant read that every test passes.
 *
 * This is exactly the machine-checkable minutia [ADR-0050] says belongs in a
 * test rather than in a record — so the record says "a test does this" and
 * this is the test.
 */

/**
 * Every `PgTable` the schema namespace exports, by export name.
 *
 * The namespace also holds enums, relations and the `citext` column helper, so
 * the filter is `is(…, PgTable)` — drizzle's own runtime brand check, which is
 * the only thing that can tell a table from a builder that produces one. Typed
 * through `[string, unknown][]` because the namespace's inferred entry type is
 * a union of every export, and a type predicate has to be assignable to what
 * it narrows.
 */
const tableExports = (Object.entries(schema) as [string, unknown][]).filter(
  (entry): entry is [string, PgTable] => is(entry[1], PgTable),
);

/**
 * The diff both assertions below are made of, as a function, so the negative
 * case can run it against a list with a hole in it.
 *
 * Returns the names present in `expected` but absent from `actual` — never the
 * other way round: an entry a list carries that the schema does not is a
 * separate mistake with a separate failure (ESLint rejects an unknown import
 * name; a truncate of a non-existent table errors), and folding the two
 * together would make one test that fails for two reasons.
 */
const missingFrom = (
  actual: readonly string[],
  expected: readonly string[],
): string[] => expected.filter((name) => !actual.includes(name));

/**
 * The physical names of every table carrying the tenant column (ADR-0067 §5).
 *
 * Read from the schema rather than from a list, which is the point: the list
 * is what this is compared against.
 *
 * **Two ways of recognising one, and the foreign key is the load-bearing
 * half.** A name check alone reads the column key, which is `organizationId`
 * only because nothing in this schema spells a column name explicitly
 * (`_shared.ts`); the day somebody writes `uuid("organization_id")` or calls
 * the property something else, a name check would let the table out of
 * `TENANT_OWNED_TABLES` **silently** — the exact failure this file exists to
 * make loud. A foreign key to `organizations` cannot be spelled around, so it
 * is what the union really rests on; the name check stays beside it for a
 * table that scopes without declaring a constraint.
 */
const referencesOrganizations = (table: PgTable): boolean =>
  getTableConfig(table).foreignKeys.some(
    (key) => key.reference().foreignTable === schema.organizations,
  );

const declaresScopeColumn = (table: PgTable): boolean =>
  getTableConfig(table).columns.some(
    (column) => column.name === TENANT_SCOPE_COLUMN,
  );

const scopedTableNames = tableExports
  .filter(
    ([, table]) =>
      // `organizations` references `users`, not itself, so the tenant is not
      // caught by its own rule (ADR-0067 §1: it is the tenant, not a thing a
      // tenant owns).
      table !== schema.organizations &&
      (declaresScopeColumn(table) || referencesOrganizations(table)),
  )
  .map(([, table]) => getTableName(table));

/**
 * The names in `names` whose table declares no row-level-security policy, or
 * which no exported table carries at all — a listed name the schema does not
 * hold is reported rather than passed over.
 */
const unpolicedTables = (names: readonly string[]): string[] =>
  names.filter((name) => {
    const entry = tableExports.find(
      ([, table]) => getTableName(table) === name,
    );

    return (
      entry === undefined || getTableConfig(entry[1]).policies.length === 0
    );
  });

/**
 * The physical names of every table carrying an expiry — a column whose
 * declared key ends in `expiresAt`, so `sessions.refreshTokenExpiresAt` is
 * caught beside the plain `expiresAt` of the token tables (`D28.4`, `DB-08`).
 * `_?` so a column declared with an explicit `expires_at` name is caught too.
 */
const expiringTableNames = tableExports
  .filter(([, table]) =>
    getTableConfig(table).columns.some((column) =>
      /expires_?at$/i.test(column.name),
    ),
  )
  .map(([, table]) => getTableName(table));

describe("the schema's tables", () => {
  it("are what this test compares against — a non-empty, named set", () => {
    // The guard that keeps the two assertions below from passing vacuously if
    // the export shape of `schema/index.ts` ever changes: an empty list is
    // missing from nothing.
    expect(tableExports.length).toBeGreaterThan(0);
    expect(tableExports.map(([name]) => name)).toContain("auditEvents");
    // The same guard for the scoped subset: an empty one is missing from
    // nothing, and the tenancy assertions below would pass vacuously.
    expect(scopedTableNames.length).toBeGreaterThan(0);
  });

  it("are every one of them banned from services and controllers (ADR-0009, ADR-0058)", () => {
    const missing = missingFrom(
      RESTRICTED_SCHEMA_TABLE_IMPORTS,
      tableExports.map(([exportName]) => exportName),
    );

    expect(
      missing,
      `add these to RESTRICTED_SCHEMA_TABLE_IMPORTS in packages/config-eslint/api.js: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("are every one of them truncated between integration files (ADR-0021)", () => {
    const missing = missingFrom(
      TRUNCATED_TABLES,
      tableExports.map(([, table]) => getTableName(table)),
    );

    expect(
      missing,
      `add these to TRUNCATED_TABLES in packages/db/src/testing.ts: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("are every one of the scoped ones in TENANT_OWNED_TABLES (ADR-0067 §5)", () => {
    const missing = missingFrom(TENANT_OWNED_TABLES, scopedTableNames);

    expect(
      missing,
      `add these to TENANT_OWNED_TABLES in packages/db/src/testing.ts: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("carry the scope column TENANT_OWNED_TABLES claims for them", () => {
    // The other direction, which `missingFrom` deliberately does not cover.
    // For the two lists above an entry the schema does not hold fails
    // elsewhere — ESLint rejects an unknown import name, a truncate of a
    // missing table errors. This one has no such second line of defence: a
    // table listed here that carries no `organization_id` would silently make
    // every reviewer look for a scope that cannot exist.
    expect([...TENANT_OWNED_TABLES].sort()).toEqual(
      TENANT_OWNED_TABLES.filter((name) =>
        scopedTableNames.includes(name),
      ).sort(),
    );
  });

  it("every tenant-owned table carries a policy", () => {
    // ADR-0067 §5's row-level security, built at `D29.4` (ADR-0078 §4 as
    // amended). A table in `TENANT_OWNED_TABLES` with no policy would have
    // row-level security off — drizzle-kit enables it only on a table that
    // declares one — and its rows would be the one place a query that forgot
    // its organization still read every tenant's.
    const unpoliced = unpolicedTables(TENANT_OWNED_TABLES);

    expect(
      unpoliced,
      `declare pgPolicy entries on these tables in packages/db/src/schema: ${unpoliced.join(", ")}`,
    ).toEqual([]);

    // The negative case: a table that declares none is reported by name.
    expect(unpolicedTables(["users"])).toEqual(["users"]);
  });

  it("every expiring table is pruned or excluded by name", () => {
    // `DB-08`: the sweep's table list was the fourth enumeration with no test.
    // A table that carries an expiry is either swept by `db:sessions:prune`
    // or named, with its reason, as never swept — a sixth flow's token table
    // in neither list is a table that grows for ever and nothing says so.
    expect(expiringTableNames.length).toBeGreaterThan(0);

    const missing = missingFrom(
      [...PRUNED_TABLES, ...NEVER_PRUNED_TABLES],
      expiringTableNames,
    );

    expect(
      missing,
      `sweep these in packages/db/src/prune-sessions.ts or name them in NEVER_PRUNED_TABLES: ${missing.join(", ")}`,
    ).toEqual([]);

    // The negative case: a table removed from both lists is reported by name.
    const [firstPruned, ...restPruned] = PRUNED_TABLES;

    expect(
      missingFrom([...restPruned, ...NEVER_PRUNED_TABLES], expiringTableNames),
    ).toEqual([firstPruned]);
  });

  it("would be reported by name if a list lost one — the negative case", () => {
    // The assertions above are only worth their runtime if they fail when the
    // thing they check is false. Proved here rather than by commenting a line
    // out by hand: the same `missingFrom` both use, against each real list
    // with its first entry removed.
    const [firstBanned, ...restBanned] = RESTRICTED_SCHEMA_TABLE_IMPORTS;
    const [firstTruncated, ...restTruncated] = TRUNCATED_TABLES;

    expect(
      missingFrom(
        restBanned,
        tableExports.map(([exportName]) => exportName),
      ),
    ).toEqual([firstBanned]);

    expect(
      missingFrom(
        restTruncated,
        tableExports.map(([, table]) => getTableName(table)),
      ),
    ).toEqual([firstTruncated]);

    const [firstScoped, ...restScoped] = TENANT_OWNED_TABLES;

    expect(missingFrom(restScoped, scopedTableNames)).toEqual([firstScoped]);
  });
});
