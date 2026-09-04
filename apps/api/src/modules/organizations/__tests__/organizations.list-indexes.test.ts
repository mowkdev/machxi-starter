import {
  LIST_INVITATIONS_FILTERABLE,
  LIST_INVITATIONS_SORTABLE,
  LIST_MEMBERSHIPS_FILTERABLE,
  LIST_MEMBERSHIPS_SORTABLE,
  LIST_ORGANIZATIONS_FILTERABLE,
  LIST_ORGANIZATIONS_SORTABLE,
} from "@repo/contracts";
import {
  organizationInvitations,
  organizationMemberships,
  organizations,
} from "@repo/db";
import { TENANT_SCOPE_COLUMN, uncoveredListColumns } from "@repo/db/testing";
import { describe, expect, it } from "vitest";

import { listColumns as invitationColumns } from "../invitations.repository.js";
import { listColumns as membershipColumns } from "../memberships.repository.js";
import {
  listColumns as organizationColumns,
  searchColumns,
} from "../organizations.repository.js";

import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * The allow-list/index pairing of ADR-0060 §3, for the three lists this module
 * serves — and the first time that pairing is checked on **tenant-owned**
 * tables (ADR-0067 §1).
 *
 * > A column enters a `sortable`, `filterable` or searchable allow-list only
 * > with its index in the same step.
 *
 * The users twin explains the arrangement; what is new here is `scopedBy`. On
 * a table carrying `organization_id`, the indexes are led by the tenant —
 * `(organization_id, column, tiebreaker)` is the pagination key itself — so
 * without the option every tenant-led index would read as coverage of
 * `organizationId` alone and every sortable column would read as uncovered.
 * That was the tension ADR-0063 §3 recorded; ADR-0067 §1 settles it by
 * dropping the bare pairs and teaching this reader the scope.
 *
 * `organizations` takes no `scopedBy` and that is the point of the third
 * block: it is the tenant rather than tenant-owned, so it keeps the ordinary
 * bare pairs and the same checker reads it the same way it reads `users`.
 */

const columnFor =
  (map: Record<string, PgColumn | undefined>, listName: string) =>
  (field: string): PgColumn => {
    const column = map[field];

    if (column === undefined) {
      throw new Error(
        `"${field}" is allow-listed by ${listName} but absent from its ColumnMap.`,
      );
    }

    return column;
  };

const organizationColumn = columnFor(
  organizationColumns,
  "listOrganizationsQuery",
);
const membershipColumn = columnFor(membershipColumns, "listMembershipsQuery");
const invitationColumn = columnFor(invitationColumns, "listInvitationsQuery");

describe("the organizations list allow-lists and indexes (ADR-0060 §3)", () => {
  it("gives every sortable column a complete btree index", () => {
    expect(
      uncoveredListColumns(organizations, {
        ordered: LIST_ORGANIZATIONS_SORTABLE.map(organizationColumn),
      }).ordered,
    ).toEqual([]);
  });

  it("gives every filterable column an index, partial ones counting", () => {
    expect(
      uncoveredListColumns(organizations, {
        filtered: Object.keys(LIST_ORGANIZATIONS_FILTERABLE).map(
          organizationColumn,
        ),
      }).filtered,
    ).toEqual([]);
  });

  it("gives every column q searches a GIN index", () => {
    expect(
      uncoveredListColumns(organizations, {
        searched: [...searchColumns],
      }).searched,
    ).toEqual([]);
  });

  /*
   * The negative case, which is what makes the three above worth running.
   * `createdBy` has a `(created_by, id)` index and belongs to no allow-list;
   * `deletedAt`'s only index is partial, so it filters and orders nothing —
   * which is why it is filterable and not sortable.
   */
  it("reports a column that claims an order nothing serves", () => {
    expect(
      uncoveredListColumns(organizations, { searched: [organizations.kind] })
        .searched,
    ).toEqual(["kind"]);

    expect(
      uncoveredListColumns(organizations, {
        ordered: [organizations.deletedAt],
      }).ordered,
    ).toEqual(["deletedAt"]);

    expect(
      uncoveredListColumns(organizations, {
        filtered: [organizations.deletedAt],
      }).filtered,
    ).toEqual([]);
  });
});

describe("the memberships list allow-lists and indexes (ADR-0067 §1)", () => {
  it("counts a tenant-led index as coverage of its second column", () => {
    expect(
      uncoveredListColumns(organizationMemberships, {
        scopedBy: TENANT_SCOPE_COLUMN,
        ordered: LIST_MEMBERSHIPS_SORTABLE.map(membershipColumn),
        filtered: Object.keys(LIST_MEMBERSHIPS_FILTERABLE).map(
          membershipColumn,
        ),
      }),
    ).toMatchObject({ ordered: [], filtered: [] });
  });

  /*
   * The negative case for the option itself, and the reason this file names
   * `scopedBy` in a test rather than trusting it: **without** the scope, the
   * same indexes cover nothing but the tenant column, because only an index's
   * leading column orders by that column. If `scopedBy` ever stopped being
   * honoured, this is what would fail rather than the case above silently
   * passing for the wrong reason.
   */
  it("reads the same indexes as covering nothing when the scope is not declared", () => {
    expect(
      uncoveredListColumns(organizationMemberships, {
        ordered: LIST_MEMBERSHIPS_SORTABLE.map(membershipColumn),
      }).ordered,
    ).toEqual(["createdAt", "role"]);
  });
});

describe("the invitations list allow-lists and indexes (ADR-0067 §1, §2)", () => {
  it("counts a tenant-led index as coverage of its second column", () => {
    expect(
      uncoveredListColumns(organizationInvitations, {
        scopedBy: TENANT_SCOPE_COLUMN,
        ordered: LIST_INVITATIONS_SORTABLE.map(invitationColumn),
        filtered: Object.keys(LIST_INVITATIONS_FILTERABLE).map(
          invitationColumn,
        ),
      }),
    ).toMatchObject({ ordered: [], filtered: [] });
  });

  /**
   * **The one check on this table that the index side cannot make** (ADR-0067
   * §2, amended).
   *
   * `token_hash` is `unique`, and `indexCoverage` reports a unique column as
   * covered — so every check in this file would happily accept
   * `sort=tokenHash`. What keeps a credential digest out of a query string and
   * out of an ordered page is the *allow-list* alone: the contracts tuples and
   * the repository's `ColumnMap`, neither of which names it.
   *
   * So this asserts the absence, on both sides, and asserts that the column is
   * indeed covered — because a reader who saw only "it is not allow-listed"
   * might reasonably add it, and the point is that nothing about the schema
   * would stop them.
   */
  it("keeps the credential digest out of every allow-list, which the indexes would not", () => {
    expect(
      uncoveredListColumns(organizationInvitations, {
        scopedBy: TENANT_SCOPE_COLUMN,
        ordered: [organizationInvitations.tokenHash],
      }).ordered,
    ).toEqual([]);

    expect([...LIST_INVITATIONS_SORTABLE]).not.toContain("tokenHash");
    expect(Object.keys(LIST_INVITATIONS_FILTERABLE)).not.toContain("tokenHash");
    expect(Object.keys(invitationColumns)).not.toContain("tokenHash");
  });
});
