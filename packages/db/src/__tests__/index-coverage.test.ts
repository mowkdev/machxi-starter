import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { organizationMemberships, organizations } from "../schema/index.js";
import {
  indexCoverage,
  TENANT_SCOPE_COLUMN,
  uncoveredListColumns,
} from "../testing.js";

/**
 * `indexCoverage`'s `scopedBy` option (ADR-0067 §1).
 *
 * The rule it encodes: on a table scoped by `organization_id`, an index that
 * leads with the scope covers its **second** column. Without it a tenant-owned
 * table would have to declare two index sets per sortable column — the
 * tenant-led composite a query actually reads, and a bare `(column, id)` pair
 * that exists only so this reader can see it — which is a write cost every
 * fork would pay forever on every tenant table. ADR-0063 §3 recorded that
 * tension; ADR-0067 §1 settles it here.
 *
 * The tables below are declared in this file rather than taken from the schema
 * because the assertion is about the *reader*, and the negative case needs a
 * table that is deliberately wrong — which no committed schema may be.
 */

/** A tenant-owned table, indexed the way ADR-0067 §1 says: tenant-led, no bare pairs. */
const scopedWidgets = pgTable(
  "scoped_widgets",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    name: text().notNull(),
    colour: text(),
  },
  (table) => [
    index("scoped_widgets_organization_id_name_idx").on(
      table.organizationId,
      table.name,
      table.id,
    ),
  ],
);

/** The same declarations on a table that is **not** scoped. */
const plainWidgets = pgTable(
  "plain_widgets",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    name: text().notNull(),
    colour: text(),
  },
  (table) => [
    index("plain_widgets_organization_id_name_idx").on(
      table.organizationId,
      table.name,
      table.id,
    ),
  ],
);

describe("indexCoverage with scopedBy", () => {
  it("reads a (organization_id, name, id) index as coverage of name", () => {
    const coverage = indexCoverage(scopedWidgets, {
      scopedBy: TENANT_SCOPE_COLUMN,
    });

    expect(coverage.ordered.has("name")).toBe(true);
    expect(coverage.filtered.has("name")).toBe(true);
  });

  it("reads the same index as coverage of organization_id when the table is not scoped", () => {
    // The negative case, and the whole reason the option exists: the identical
    // declaration attributes to its leading column, so `name` claims an order
    // nothing serves.
    const coverage = indexCoverage(plainWidgets);

    expect(coverage.ordered.has("name")).toBe(false);
    expect(coverage.ordered.has("organizationId")).toBe(true);
  });

  it("keeps the scope column itself covered on a scoped table", () => {
    // An index leads with the scope, so a filter on the scope is served by it
    // whichever way the attribution reads.
    const coverage = indexCoverage(scopedWidgets, {
      scopedBy: TENANT_SCOPE_COLUMN,
    });

    expect(coverage.filtered.has("organizationId")).toBe(true);
  });

  it("still reports a column no index leads or follows the scope with", () => {
    expect(
      uncoveredListColumns(scopedWidgets, {
        scopedBy: TENANT_SCOPE_COLUMN,
        ordered: [scopedWidgets.name, scopedWidgets.colour],
      }).ordered,
    ).toEqual(["colour"]);
  });

  it("reads a composite primary key as the index Postgres builds for it", () => {
    // `organization_memberships` has no surrogate id: its `(organization_id,
    // user_id)` key is what orders the members list (ADR-0067 §2).
    const coverage = indexCoverage(organizationMemberships, {
      scopedBy: TENANT_SCOPE_COLUMN,
    });

    expect(coverage.ordered.has("userId")).toBe(true);
    expect(coverage.ordered.has("createdAt")).toBe(true);
    expect(coverage.ordered.has("role")).toBe(true);
  });

  it("leaves the tenant table itself on ADR-0060 §3's bare pairs", () => {
    // `organizations` is the tenant, not something a tenant owns, so it is read
    // with no scope at all and every sortable column leads its own index.
    const coverage = indexCoverage(organizations);

    for (const column of ["createdAt", "updatedAt", "name", "slug", "kind"]) {
      expect(coverage.ordered.has(column)).toBe(true);
    }

    expect(coverage.searched.has("name")).toBe(true);
    expect(coverage.searched.has("slug")).toBe(true);
  });
});
