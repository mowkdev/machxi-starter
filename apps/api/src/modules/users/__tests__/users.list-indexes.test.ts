import { users } from "@repo/db";
import { uncoveredListColumns } from "@repo/db/testing";
import { LIST_USERS_FILTERABLE, LIST_USERS_SORTABLE } from "@repo/contracts";
import { describe, expect, it } from "vitest";

import { listColumns, searchColumns } from "../users.repository.js";

import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * The allow-list/index pairing of ADR-0060 §3, for `GET /api/v1/admin/users`.
 *
 * > A column enters a `sortable`, `filterable` or searchable allow-list only
 * > with its index in the same step.
 *
 * ADR-0014 §Consequences claimed that "allow-listing prevents
 * sorting/filtering on non-indexed columns"; it was the one sentence in that
 * record the schema did not back, because nothing joined the two lists. This
 * is what joins them, and it is deliberately a set comparison rather than a
 * query planner in a test: it names the columns that claim an order nothing
 * serves.
 *
 * Both sides are read from the objects the endpoint itself uses — the schema's
 * `sortable` and `filterable` tuples from `@repo/contracts`, the columns they
 * resolve to from the repository's own `ColumnMap`, and the index declarations
 * from `@repo/db`. A copy of any of the three would pass while the endpoint
 * was broken.
 *
 * **Sorting and filtering are checked against different sets**, because a
 * partial index is not half an index — it is a whole index of some of the
 * rows. It can serve a filter that implies its predicate and it cannot order a
 * list that does not.
 */

const columnFor = (field: string): PgColumn => {
  const column = listColumns[field];

  if (column === undefined) {
    throw new Error(
      `"${field}" is allow-listed by listUsersQuery but absent from the users ColumnMap.`,
    );
  }

  return column;
};

const sortableColumns = LIST_USERS_SORTABLE.map(columnFor);
const filterableColumns = Object.keys(LIST_USERS_FILTERABLE).map(columnFor);

describe("the users list allow-lists and the users indexes (ADR-0060 §3)", () => {
  it("gives every sortable column a complete btree index", () => {
    expect(
      uncoveredListColumns(users, { ordered: sortableColumns }).ordered,
    ).toEqual([]);
  });

  it("gives every filterable column an index, partial ones counting", () => {
    expect(
      uncoveredListColumns(users, { filtered: filterableColumns }).filtered,
    ).toEqual([]);
  });

  it("gives every column q searches a GIN index", () => {
    expect(
      uncoveredListColumns(users, { searched: [...searchColumns] }).searched,
    ).toEqual([]);
  });

  /*
   * The negative case, which is what makes the three above worth running.
   *
   * `passwordHash` is a real column of this table with no index and no place
   * in any allow-list — exactly the shape of the mistake this test exists to
   * catch, and the shape it would take if someone added a column to
   * `LIST_USERS_SORTABLE` and stopped there.
   */
  it("reports a column that claims an order nothing serves", () => {
    expect(
      uncoveredListColumns(users, { ordered: [users.passwordHash] }).ordered,
    ).toEqual(["passwordHash"]);

    expect(
      uncoveredListColumns(users, { searched: [users.status] }).searched,
    ).toEqual(["status"]);
  });

  it("refuses a partial index as an order, and accepts it as a filter", () => {
    /*
     * `deletedAt` has one index, `users_deleted_at_idx`, and it is
     * `where deleted_at is not null`. That serves
     * `filter[deletedAt][null]=false` and orders nothing — which is why
     * `deletedAt` is filterable and not sortable, and why the sortable check
     * above is not satisfied by the partial `users_email_active_unique`
     * either. Delete `users_email_idx` and the first case in this file fails,
     * which is the property that makes it a check rather than a comment.
     */
    expect(
      uncoveredListColumns(users, { ordered: [users.deletedAt] }).ordered,
    ).toEqual(["deletedAt"]);

    expect(
      uncoveredListColumns(users, { filtered: [users.deletedAt] }).filtered,
    ).toEqual([]);
  });
});
