import {
  addMembershipBody,
  createOrganizationAdminBody,
  listMembershipsQuery,
  membershipRoleBody,
  filtersToRecord,
  listOrganizationsQuery,
  updateOrganizationBody,
  type AddMembershipBody,
  type CreateOrganizationAdminBody,
  type ListMembershipsQuery,
  type MembershipResource,
  type ListOrganizationsQuery,
  type UpdateOrganizationBody,
  type OrganizationResource,
} from "@repo/contracts";
import { http } from "msw";

import { API } from "./auth.handlers";
import { fail, listOk, ok, parseListSearch } from "@repo/app-kit/testing";

/**
 * The organizations endpoints, as MSW answers them (ADR-0036 §The load-bearing
 * rule).
 *
 * Every request is parsed with the schema the API validates with and every
 * response is built by the envelope helpers, so a contract change stops this
 * compiling or starts it throwing rather than letting the suite certify against
 * an API the frontend wishes it had.
 *
 * The endpoint's own semantics are implemented only as far as the UI can
 * observe them — `q`, an `eq` filter, `sort` and the page window — because those
 * are what the grid drives and what `meta.pagination.total` has to be honest
 * about. Anything deeper would be re-implementing the API, which is the mock
 * fidelity ADR-0036 warns against buying.
 *
 * `create...Handlers(state)` with no shared module state: a test that needs a
 * scripted refusal builds its own handler and `server.use()`es it.
 */

/** The account the fixtures hang off — an owner, never a staff member. */
export const ORGANIZATION_OWNER_ID = "0198c1f0-0000-7000-8000-00000000f001";

/**
 * One of each kind, because the two behave differently and the screen has to
 * show both: a `personal` organization refuses its own deletion and its own
 * slug edit (ADR-0067 §2), and a `team` one does neither.
 *
 * `role` is `null` on both, always: staff hold no membership (ADR-0067 §3),
 * and the field says so rather than being absent on one segment and present on
 * the other.
 */
export const ORGANIZATIONS_ROWS: readonly OrganizationResource[] = [
  {
    id: "0198c1f0-0000-7000-8000-000000000001",
    slug: "acme",
    name: "Acme Inc.",
    kind: "team",
    role: null,
    createdBy: ORGANIZATION_OWNER_ID,
    createdAt: "2026-01-04T10:00:00.000Z",
    updatedAt: "2026-01-04T10:00:00.000Z",
    deletedAt: null,
  },
  {
    id: "0198c1f0-0000-7000-8000-000000000002",
    slug: `personal-${ORGANIZATION_OWNER_ID}`,
    name: "Cleo Customer",
    kind: "personal",
    role: null,
    createdBy: ORGANIZATION_OWNER_ID,
    createdAt: "2026-02-11T10:00:00.000Z",
    updatedAt: "2026-02-11T10:00:00.000Z",
    deletedAt: null,
  },
];

/**
 * The memberships of the `team` fixture — an owner and a member, which is the
 * smallest set the section's three writes can be exercised against: a role can
 * be changed on one of them, and the other is what makes "the last owner" not
 * the case being tested.
 */
export const ORGANIZATION_MEMBER_ROWS: readonly MembershipResource[] = [
  {
    organizationId: "0198c1f0-0000-7000-8000-000000000001",
    userId: ORGANIZATION_OWNER_ID,
    email: "cleo@machxi.local",
    firstName: "Cleo",
    lastName: "Customer",
    role: "owner",
    createdAt: "2026-01-04T10:00:00.000Z",
    updatedAt: "2026-01-04T10:00:00.000Z",
  },
  {
    organizationId: "0198c1f0-0000-7000-8000-000000000001",
    userId: "0198c1f0-0000-7000-8000-00000000f002",
    email: "morgan@machxi.local",
    firstName: "Morgan",
    lastName: "Member",
    role: "member",
    createdAt: "2026-01-05T10:00:00.000Z",
    updatedAt: "2026-01-05T10:00:00.000Z",
  },
];

export interface OrganizationMockState {
  rows: OrganizationResource[];
  members: MembershipResource[];
  /** What the client actually asked for, for assertions that need the wire. */
  readonly seen: {
    list: ListOrganizationsQuery[];
    created: CreateOrganizationAdminBody[];
    updated: { id: string; body: UpdateOrganizationBody }[];
    deleted: string[];
    memberList: ListMembershipsQuery[];
    membersAdded: { organizationId: string; body: AddMembershipBody }[];
    memberRoles: { organizationId: string; userId: string; role: string }[];
    membersRemoved: { organizationId: string; userId: string }[];
  };
}

export const createOrganizationMockState = (
  rows: readonly OrganizationResource[] = ORGANIZATIONS_ROWS,
  members: readonly MembershipResource[] = ORGANIZATION_MEMBER_ROWS,
): OrganizationMockState => ({
  rows: [...rows],
  members: [...members],
  seen: {
    list: [],
    created: [],
    updated: [],
    deleted: [],
    memberList: [],
    membersAdded: [],
    memberRoles: [],
    membersRemoved: [],
  },
});

const valueOf = (row: OrganizationResource, field: string): string =>
  String((row as unknown as Record<string, unknown>)[field] ?? "");

const applyQuery = (
  rows: readonly OrganizationResource[],
  query: ListOrganizationsQuery,
): readonly OrganizationResource[] => {
  let result = [...rows];

  if (query.q !== undefined)
    result = result.filter((row) =>
      row.name.toLowerCase().includes((query.q ?? "").toLowerCase()),
    );

  for (const filter of query.filters) {
    if (filter.op === "eq")
      result = result.filter(
        (row) => valueOf(row, filter.field) === String(filter.value),
      );
  }

  for (const { field, direction } of [...query.sort].reverse()) {
    result.sort((left, right) =>
      direction === "desc"
        ? valueOf(right, field).localeCompare(valueOf(left, field))
        : valueOf(left, field).localeCompare(valueOf(right, field)),
    );
  }

  return result;
};

export const createOrganizationsHandlers = (
  organizationState: OrganizationMockState,
) => [
  http.get(`${API}/organizations`, ({ request }): Response => {
    // The endpoint's own schema. A `sort` field or an operator the contract
    // does not allow-list throws here, in the test, rather than reaching an
    // operator as a `VALIDATION_ERROR`.
    const query = parseListSearch(request.url, listOrganizationsQuery);

    organizationState.seen.list.push(query);

    const matched = applyQuery(organizationState.rows, query);

    return listOk({
      items: matched.slice(query.offset, query.offset + query.limit),
      total: query.count ? matched.length : null,
      offset: query.offset,
      limit: query.limit,
      sort: query.sort,
      filters: filtersToRecord(query.filters),
    });
  }),

  http.get(`${API}/organizations/:id`, ({ params }): Response => {
    const row = organizationState.rows.find(
      (candidate) => candidate.id === params["id"],
    );

    return row === undefined ? fail(404, "NOT_FOUND") : ok(row);
  }),

  http.post(`${API}/organizations`, async ({ request }): Promise<Response> => {
    const body = createOrganizationAdminBody.parse(await request.json());

    organizationState.seen.created.push(body);

    const created: OrganizationResource = {
      id: `0198c1f0-0000-7000-8000-${String(organizationState.rows.length + 1).padStart(12, "0")}`,
      slug: body.slug,
      name: body.name,
      // `team`, always: a `personal` organization is created with its account
      // and the admin create takes no `kind` (ADR-0067 §3).
      kind: "team",
      role: null,
      createdBy: body.ownerId,
      createdAt: "2026-03-01T10:00:00.000Z",
      updatedAt: "2026-03-01T10:00:00.000Z",
      deletedAt: null,
    };

    organizationState.rows = [...organizationState.rows, created];

    return ok(created, 201);
  }),

  http.patch(
    `${API}/organizations/:id`,
    async ({ params, request }): Promise<Response> => {
      const body = updateOrganizationBody.parse(await request.json());
      const id = String(params["id"]);
      const current = organizationState.rows.find((row) => row.id === id);

      if (current === undefined) return fail(404, "NOT_FOUND");

      organizationState.seen.updated.push({ id, body });

      // The API refuses a slug edit on a `personal` organization with `409`
      // (ADR-0067 §2), and a mock more permissive than the service certifies
      // the opposite of production (ADR-0036).
      if (body.slug !== undefined && current.kind === "personal") {
        return fail(409, "ORGANIZATION_PERSONAL_UNDELETABLE");
      }

      const next: OrganizationResource = {
        ...current,
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.slug === undefined ? {} : { slug: body.slug }),
        updatedAt: "2026-03-02T10:00:00.000Z",
      };

      organizationState.rows = organizationState.rows.map((row) =>
        row.id === id ? next : row,
      );

      return ok(next);
    },
  ),

  http.delete(`${API}/organizations/:id`, ({ params }): Response => {
    const id = String(params["id"]);
    const current = organizationState.rows.find((row) => row.id === id);

    if (current === undefined) return fail(404, "NOT_FOUND");

    /*
     * The refusal the screen's own copy promises twice — `delete.description`
     * and `bulkDelete.description` both say a personal organization is refused
     * — and the fixtures ship one, so a mock that deleted it would certify the
     * opposite of production for the one case the copy is about (ADR-0036,
     * ADR-0067 §2).
     */
    if (current.kind === "personal")
      return fail(409, "ORGANIZATION_PERSONAL_UNDELETABLE");

    organizationState.seen.deleted.push(id);
    /*
     * **Soft**, like the API: the row survives with `deletedAt` set, and
     * `GET /:id` keeps answering `200` for it. Dropping the row would make the
     * mock answer `404` where the service answers `200` — and would hide the
     * `deletedAt` column and the deleted-only stance from every test.
     */
    organizationState.rows = organizationState.rows.map((row) =>
      row.id === id ? { ...row, deletedAt: "2026-03-04T10:00:00.000Z" } : row,
    );

    return new Response(null, { status: 204 });
  }),

  /*
   * The memberships sub-resource (ADR-0067 §3). Four handlers for four
   * operations, and each of them keeps the refusals the API gives rather than
   * the happy path alone — a mock more permissive than the service certifies
   * the opposite of production (ADR-0036).
   */
  http.get(
    `${API}/organizations/:id/memberships`,
    ({ params, request }): Response => {
      const organizationId = String(params["id"]);

      if (!organizationState.rows.some((row) => row.id === organizationId))
        return fail(404, "NOT_FOUND");

      /*
       * Parsed with the schema the API validates with, which is this file's
       * own rule and was worth restating: a section that asked to sort by a
       * column outside `LIST_MEMBERSHIPS_SORTABLE` would pass a suite that
       * ignored the query string and answer `VALIDATION_ERROR` in production
       * (`D15.4`'s review).
       */
      const query = parseListSearch(request.url, listMembershipsQuery);

      if (query === undefined) return fail(400, "VALIDATION_ERROR");

      organizationState.seen.memberList.push(query);

      const rows = organizationState.members.filter(
        (row) => row.organizationId === organizationId,
      );

      return listOk({
        items: rows.slice(query.offset, query.offset + query.limit),
        total: rows.length,
        offset: query.offset,
        limit: query.limit,
        sort: query.sort,
        filters: filtersToRecord(query.filters),
      });
    },
  ),

  http.post(
    `${API}/organizations/:id/memberships`,
    async ({ params, request }): Promise<Response> => {
      const organizationId = String(params["id"]);
      const organization = organizationState.rows.find(
        (row) => row.id === organizationId,
      );

      if (organization === undefined) return fail(404, "NOT_FOUND");

      // A personal organization has exactly one member (ADR-0067 §2).
      if (organization.kind === "personal")
        return fail(409, "ORGANIZATION_PERSONAL_CLOSED");

      const body = addMembershipBody.parse(await request.json());

      organizationState.seen.membersAdded.push({ organizationId, body });

      if (
        organizationState.members.some(
          (row) =>
            row.organizationId === organizationId && row.userId === body.userId,
        )
      ) {
        // Idempotent by the composite primary key, and the existing row wins.
        return new Response(null, { status: 204 });
      }

      organizationState.members = [
        ...organizationState.members,
        {
          organizationId,
          userId: body.userId,
          email: `added-${body.userId.slice(0, 8)}@machxi.local`,
          firstName: null,
          lastName: null,
          role: body.role,
          createdAt: "2026-03-03T10:00:00.000Z",
          updatedAt: "2026-03-03T10:00:00.000Z",
        },
      ];

      return new Response(null, { status: 204 });
    },
  ),

  http.patch(
    `${API}/organizations/:id/memberships/:userId`,
    async ({ params, request }): Promise<Response> => {
      const organizationId = String(params["id"]);
      const userId = String(params["userId"]);
      const body = membershipRoleBody.parse(await request.json());
      const current = organizationState.members.find(
        (row) => row.organizationId === organizationId && row.userId === userId,
      );

      if (current === undefined) return fail(404, "NOT_FOUND");

      // The last-owner invariant, which the section has to be able to render a
      // refusal for (ADR-0067 §2).
      if (
        current.role === "owner" &&
        body.role !== "owner" &&
        organizationState.members.filter(
          (row) =>
            row.organizationId === organizationId &&
            row.role === "owner" &&
            row.userId !== userId,
        ).length === 0
      ) {
        return fail(409, "ORGANIZATION_LAST_OWNER");
      }

      organizationState.seen.memberRoles.push({
        organizationId,
        userId,
        role: body.role,
      });
      organizationState.members = organizationState.members.map((row) =>
        row === current ? { ...row, role: body.role } : row,
      );

      return new Response(null, { status: 204 });
    },
  ),

  http.delete(
    `${API}/organizations/:id/memberships/:userId`,
    ({ params }): Response => {
      const organizationId = String(params["id"]);
      const userId = String(params["userId"]);
      const current = organizationState.members.find(
        (row) => row.organizationId === organizationId && row.userId === userId,
      );

      if (current === undefined) return fail(404, "NOT_FOUND");

      if (
        current.role === "owner" &&
        organizationState.members.filter(
          (row) =>
            row.organizationId === organizationId &&
            row.role === "owner" &&
            row.userId !== userId,
        ).length === 0
      ) {
        return fail(409, "ORGANIZATION_LAST_OWNER");
      }

      organizationState.seen.membersRemoved.push({ organizationId, userId });
      organizationState.members = organizationState.members.filter(
        (row) => row !== current,
      );

      return new Response(null, { status: 204 });
    },
  ),
];
