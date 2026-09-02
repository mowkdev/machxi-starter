import { staff } from "@repo/db";
import { uncoveredListColumns } from "@repo/db/testing";
import { LIST_STAFF_FILTERABLE, LIST_STAFF_SORTABLE } from "@repo/contracts";
import { describe, expect, it } from "vitest";

import { listColumns, searchColumns } from "../staff.repository.js";

import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * The allow-list/index pairing of ADR-0060 §3, for `GET /api/v1/admin/staff` —
 * the mirror of `users.list-indexes.test.ts`, and separate for the reason the
 * two repositories are: the tables differ where it matters.
 *
 * `email` is the difference worth naming. It is unique across the whole
 * `staff` table, so Postgres has already built a complete btree index for it
 * and the schema declares no second one; `users.email` is unique only among
 * live rows, so that table carries `users_email_idx` as well.
 * `uncoveredListColumns` counts a column-level `.unique()` as complete
 * coverage — a column constraint cannot be partial — which is what lets one
 * rule hold over both shapes without either table getting an index it does
 * not need.
 */

const columnFor = (field: string): PgColumn => {
  const column = listColumns[field];

  if (column === undefined) {
    throw new Error(
      `"${field}" is allow-listed by listStaffQuery but absent from the staff ColumnMap.`,
    );
  }

  return column;
};

const sortableColumns = LIST_STAFF_SORTABLE.map(columnFor);
const filterableColumns = Object.keys(LIST_STAFF_FILTERABLE).map(columnFor);

describe("the staff list allow-lists and the staff indexes (ADR-0060 §3)", () => {
  it("gives every sortable column a complete btree index", () => {
    expect(
      uncoveredListColumns(staff, { ordered: sortableColumns }).ordered,
    ).toEqual([]);
  });

  it("gives every filterable column an index, partial ones counting", () => {
    expect(
      uncoveredListColumns(staff, { filtered: filterableColumns }).filtered,
    ).toEqual([]);
  });

  it("gives every column q searches a GIN index", () => {
    expect(
      uncoveredListColumns(staff, { searched: [...searchColumns] }).searched,
    ).toEqual([]);
  });

  /** The negative case: without it the three above could pass vacuously. */
  it("reports a column that claims an order nothing serves", () => {
    expect(
      uncoveredListColumns(staff, { ordered: [staff.passwordHash] }).ordered,
    ).toEqual(["passwordHash"]);

    expect(
      uncoveredListColumns(staff, { searched: [staff.status] }).searched,
    ).toEqual(["status"]);
  });
});
