import { RESTRICTED_SCHEMA_TABLE_IMPORTS } from "@repo/eslint-config/api";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as schema from "../schema/index.js";
import { TRUNCATED_TABLES } from "../testing.js";

/**
 * The two hand-maintained table enumerations, checked against the schema
 * (ADR-0061 §4).
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

describe("the schema's tables", () => {
  it("are what this test compares against — a non-empty, named set", () => {
    // The guard that keeps the two assertions below from passing vacuously if
    // the export shape of `schema/index.ts` ever changes: an empty list is
    // missing from nothing.
    expect(tableExports.length).toBeGreaterThan(0);
    expect(tableExports.map(([name]) => name)).toContain("auditEvents");
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
  });
});
