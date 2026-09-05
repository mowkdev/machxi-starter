import {
  createInvitationBody,
  createOrganizationBody,
  filtersToRecord,
  listInvitationsQuery,
  listMembershipsQuery,
  membershipRoleBody,
  updateOrganizationBody,
  type CreateInvitationBody,
  type CreateOrganizationBody,
  type InvitationResource,
  type MembershipResource,
  type OrganizationResource,
  type OrganizationRole,
  type UpdateOrganizationBody,
} from "@repo/contracts";
import { http, type HttpHandler } from "msw";

import { userPrincipal } from "@/test/principals";

import { API } from "./auth.handlers";
import { fail, listOk, ok } from "./envelope";
import { parseListSearch } from "./list-query";

/**
 * `/api/v1/user/orgs` and `/api/v1/user/invitations`, as MSW answers them
 * (ADR-0036 §The load-bearing rule, ADR-0067 §4).
 *
 * Every request is parsed with the schema the API validates with, and every
 * response goes through the envelope builders typed against the contract — so a
 * body this app builds wrongly throws here rather than being quietly accepted
 * by a mock that is kinder than the server.
 *
 * **The refusals are modelled, and they are the point of this file.** A members
 * table whose mock let the last owner leave would certify a screen that shows
 * no refusal copy, which is precisely what the deliverable's done-when asks
 * about. So:
 *
 * - `ORGANIZATION_LAST_OWNER` on removing or demoting the only owner, which is
 *   one invariant the API enforces in one place for both writes (ADR-0067 §2);
 * - `ORGANIZATION_PERSONAL_UNDELETABLE` on deleting a personal organization and
 *   on re-addressing one, which is the same code for the same reason — its slug
 *   is derived from the account's id and is what proves there is one of them;
 * - `ORGANIZATION_INVITATION_PENDING` on inviting an address that already has
 *   an invitation waiting;
 * - `CONFLICT` on a slug somebody else already holds;
 * - `NOT_FOUND` for an organization the caller is not a member of — **never
 *   `403`** (ADR-0067 §4), because a `403` would confirm that the organization
 *   exists to somebody outside it.
 *
 * **The caller is `userPrincipal()`'s customer**, the same fixture the session
 * stores in this suite are built from, because two of these screens turn on
 * "is this row me": the members table marks it and offers Leave instead of
 * Remove, and the last-owner refusal is about the caller as often as not.
 */

const CALLER = userPrincipal();

const PERSONAL_ID = "0198c1f0-0000-7000-8000-00000000e001";
const TEAM_ID = "0198c1f0-0000-7000-8000-00000000e002";
const OTHER_MEMBER_ID = "0198c1f0-0000-7000-8000-00000000e0f1";

/**
 * The personal organization every account has (ADR-0067 §2).
 *
 * Its slug is derived from the owner's id, which is the fixture repeating a
 * decision rather than inventing a value: it is deterministic, collision-free
 * and leaks no address into a URL somebody pastes into a chat window.
 */
export const PERSONAL_ORGANIZATION: OrganizationResource = {
  id: PERSONAL_ID,
  slug: `personal-${CALLER.id}`,
  name: "Cara Customer",
  kind: "personal",
  role: "owner",
  createdBy: CALLER.id,
  createdAt: "2026-02-11T10:00:00.000Z",
  updatedAt: "2026-02-11T10:00:00.000Z",
  deletedAt: null,
};

/** The team the seeds create for Postman, and the one with a second member. */
export const TEAM_ORGANIZATION: OrganizationResource = {
  id: TEAM_ID,
  slug: "acme",
  name: "Acme",
  kind: "team",
  role: "owner",
  createdBy: CALLER.id,
  createdAt: "2026-03-01T10:00:00.000Z",
  updatedAt: "2026-03-01T10:00:00.000Z",
  deletedAt: null,
};

export const ORGANIZATION_ROWS: readonly OrganizationResource[] = [
  PERSONAL_ORGANIZATION,
  TEAM_ORGANIZATION,
];

/**
 * The memberships behind those two rows.
 *
 * The team has an owner and a member, which is the smallest set that can
 * exercise every rule on the screen: a role can be moved on one of them, the
 * other is what makes "the last owner" not the case, and removing the member
 * leaves the owner alone so the next attempt *is* that case.
 */
export const MEMBERSHIP_ROWS: readonly MembershipResource[] = [
  {
    organizationId: PERSONAL_ID,
    userId: CALLER.id,
    email: CALLER.email,
    firstName: CALLER.firstName,
    lastName: CALLER.lastName,
    role: "owner",
    createdAt: "2026-02-11T10:00:00.000Z",
    updatedAt: "2026-02-11T10:00:00.000Z",
  },
  {
    organizationId: TEAM_ID,
    userId: CALLER.id,
    email: CALLER.email,
    firstName: CALLER.firstName,
    lastName: CALLER.lastName,
    role: "owner",
    createdAt: "2026-03-01T10:00:00.000Z",
    updatedAt: "2026-03-01T10:00:00.000Z",
  },
  {
    organizationId: TEAM_ID,
    userId: OTHER_MEMBER_ID,
    email: "morgan@machxi.local",
    firstName: "Morgan",
    lastName: "Member",
    role: "member",
    createdAt: "2026-03-02T10:00:00.000Z",
    updatedAt: "2026-03-02T10:00:00.000Z",
  },
];

/** One invitation the team is waiting on, so the pending list is not empty. */
export const INVITATION_ROWS: readonly InvitationResource[] = [
  {
    id: "0198c1f0-0000-7000-8000-00000000e101",
    organizationId: TEAM_ID,
    organizationName: TEAM_ORGANIZATION.name,
    email: "newcomer@machxi.local",
    role: "member",
    status: "pending",
    expiresAt: "2026-09-20T10:00:00.000Z",
    createdAt: "2026-09-04T10:00:00.000Z",
  },
];

/**
 * An invitation addressed to the **caller**, from an organization they are not
 * in — which is the only shape a received invitation can have (ADR-0067 §4).
 */
export const RECEIVED_INVITATION: InvitationResource = {
  id: "0198c1f0-0000-7000-8000-00000000e201",
  organizationId: "0198c1f0-0000-7000-8000-00000000e003",
  organizationName: "Globex",
  email: CALLER.email,
  role: "admin",
  status: "pending",
  expiresAt: "2026-09-25T10:00:00.000Z",
  createdAt: "2026-09-05T10:00:00.000Z",
};

export interface OrganizationsMockState {
  organizations: OrganizationResource[];
  memberships: MembershipResource[];
  invitations: InvitationResource[];
  /** Invitations addressed to the caller's own address. */
  received: InvitationResource[];
  /** What the client actually asked for, for assertions that need the wire. */
  readonly seen: {
    created: CreateOrganizationBody[];
    updated: { organizationId: string; body: UpdateOrganizationBody }[];
    deleted: string[];
    roles: { organizationId: string; userId: string; role: string }[];
    removed: { organizationId: string; userId: string }[];
    invited: { organizationId: string; body: CreateInvitationBody }[];
    revoked: { organizationId: string; id: string }[];
    accepted: string[];
    declined: string[];
  };
}

export const createOrganizationsMockState = (): OrganizationsMockState => ({
  organizations: ORGANIZATION_ROWS.map((row) => ({ ...row })),
  memberships: MEMBERSHIP_ROWS.map((row) => ({ ...row })),
  invitations: INVITATION_ROWS.map((row) => ({ ...row })),
  received: [{ ...RECEIVED_INVITATION }],
  seen: {
    created: [],
    updated: [],
    deleted: [],
    roles: [],
    removed: [],
    invited: [],
    revoked: [],
    accepted: [],
    declined: [],
  },
});

/**
 * `requireMembership`, as far as a mock can see it (ADR-0067 §4).
 *
 * A non-member is `404` and never `403`: the caller's memberships are the whole
 * of what this state knows, so an organization missing from the list is
 * indistinguishable from one that does not exist — which is exactly the
 * property the guard exists to give.
 */
const membershipOf = (
  state: OrganizationsMockState,
  organizationId: string,
): OrganizationResource | undefined =>
  state.organizations.find((row) => row.id === organizationId);

/**
 * `requireMembership(...roles)`'s second refusal, which is **not** the first
 * (ADR-0067 §4): a caller inside the organization whose role is below the one a
 * route asks for is `403`, where a stranger is `404`. The difference is what
 * lets a client render "you are not an owner here" rather than a dead end.
 *
 * Modelled after a review finding: without it every write in this file
 * succeeded for any member, so the client-side role gates on the settings
 * screen could have been deleted with the whole suite still green.
 */
const requireRole = (
  organization: OrganizationResource,
  ...roles: readonly OrganizationRole[]
): Response | null =>
  organization.role !== null && roles.includes(organization.role)
    ? null
    : fail(403, "FORBIDDEN");

const ownersOf = (
  state: OrganizationsMockState,
  organizationId: string,
): readonly MembershipResource[] =>
  state.memberships.filter(
    (row) => row.organizationId === organizationId && row.role === "owner",
  );

export const createOrganizationsHandlers = (
  state: OrganizationsMockState,
): readonly HttpHandler[] => [
  http.get(`${API}/orgs`, () => ok(state.organizations)),

  http.post(`${API}/orgs`, async ({ request }): Promise<Response> => {
    const body = createOrganizationBody.parse(await request.json());

    if (state.organizations.some((row) => row.slug === body.slug))
      return fail(409, "CONFLICT");

    state.seen.created.push(body);

    const created: OrganizationResource = {
      id: `0198c1f0-0000-7000-8000-0000000${state.organizations.length}f00`,
      slug: body.slug,
      name: body.name,
      // Never `personal`: exactly one of those exists per account and the
      // system creates it, which is why the body has no `kind` to send.
      kind: "team",
      role: "owner",
      createdBy: CALLER.id,
      createdAt: "2026-09-05T10:00:00.000Z",
      updatedAt: "2026-09-05T10:00:00.000Z",
      deletedAt: null,
    };

    state.organizations = [...state.organizations, created];
    state.memberships = [
      ...state.memberships,
      {
        organizationId: created.id,
        userId: CALLER.id,
        email: CALLER.email,
        firstName: CALLER.firstName,
        lastName: CALLER.lastName,
        role: "owner",
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      },
    ];

    return ok(created, 201);
  }),

  http.patch(
    `${API}/orgs/:orgId`,
    async ({ params, request }): Promise<Response> => {
      const organizationId = String(params["orgId"]);
      const current = membershipOf(state, organizationId);

      if (current === undefined) return fail(404, "NOT_FOUND");

      const refusal = requireRole(current, "owner", "admin");

      if (refusal !== null) return refusal;

      const body = updateOrganizationBody.parse(await request.json());

      /*
       * A personal organization's address is derived from its account's id and
       * is what proves there is exactly one of them, so the service refuses the
       * edit with the same code it refuses the deletion with (ADR-0067 §2 as
       * amended, carried into `D15.3`).
       */
      if (body.slug !== undefined && current.kind === "personal")
        return fail(409, "ORGANIZATION_PERSONAL_UNDELETABLE");

      if (
        body.slug !== undefined &&
        state.organizations.some(
          (row) => row.slug === body.slug && row.id !== organizationId,
        )
      )
        return fail(409, "CONFLICT");

      state.seen.updated.push({ organizationId, body });

      const updated: OrganizationResource = {
        ...current,
        // Key by key rather than a spread: zod omits an absent optional key, so
        // the wholesale spread cannot be typed under `exactOptionalPropertyTypes`.
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.slug === undefined ? {} : { slug: body.slug }),
        updatedAt: "2026-09-05T12:00:00.000Z",
      };

      state.organizations = state.organizations.map((row) =>
        row.id === organizationId ? updated : row,
      );

      return ok(updated);
    },
  ),

  http.delete(`${API}/orgs/:orgId`, ({ params }): Response => {
    const organizationId = String(params["orgId"]);
    const current = membershipOf(state, organizationId);

    if (current === undefined) return fail(404, "NOT_FOUND");

    // An owner, never an admin: deleting the tenant is not delegated.
    const refusal = requireRole(current, "owner");

    if (refusal !== null) return refusal;

    // A personal organization is soft-deleted inside its account's own
    // deletion and never on its own (ADR-0067 §2).
    if (current.kind === "personal")
      return fail(409, "ORGANIZATION_PERSONAL_UNDELETABLE");

    state.seen.deleted.push(organizationId);
    /*
     * Dropped from *this* list rather than stamped with `deletedAt`, and the
     * difference from the admin's mock is the endpoint's: `GET /user/orgs`
     * answers with live memberships, so a deleted organization leaves the list
     * a customer can see rather than staying in it with a column set.
     */
    state.organizations = state.organizations.filter(
      (row) => row.id !== organizationId,
    );

    return new Response(null, { status: 204 });
  }),

  http.get(`${API}/orgs/:orgId/members`, ({ params, request }): Response => {
    const organizationId = String(params["orgId"]);

    if (membershipOf(state, organizationId) === undefined)
      return fail(404, "NOT_FOUND");

    /*
     * Parsed with the schema the API validates with: a section that asked to
     * sort by a column outside `LIST_MEMBERSHIPS_SORTABLE` would pass a suite
     * that ignored the query string and answer `VALIDATION_ERROR` in production
     * (`D15.4`'s review, on the admin's copy of this table).
     */
    const query = parseListSearch(request.url, listMembershipsQuery);
    const rows = state.memberships.filter(
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
  }),

  http.patch(
    `${API}/orgs/:orgId/members/:userId`,
    async ({ params, request }): Promise<Response> => {
      const organizationId = String(params["orgId"]);
      const userId = String(params["userId"]);
      const organization = membershipOf(state, organizationId);

      if (organization === undefined) return fail(404, "NOT_FOUND");

      // Only an owner moves roles, because granting `owner` is how ownership
      // moves and an admin who could grant it could take the tenant.
      const refusal = requireRole(organization, "owner");

      if (refusal !== null) return refusal;

      // Parsed with the schema the API validates with, like every other body in
      // this file: a cast would accept a role outside `ORGANIZATION_ROLES` that
      // production answers `VALIDATION_ERROR` to (a review finding).
      const { role } = membershipRoleBody.parse(await request.json());
      const owners = ownersOf(state, organizationId);
      const target = state.memberships.find(
        (row) => row.organizationId === organizationId && row.userId === userId,
      );

      if (target === undefined) return fail(404, "NOT_FOUND");

      /*
       * The invariant, in the one place the API keeps it: an organization
       * always has at least one owner, so demoting the last one is refused
       * exactly as removing them is (ADR-0067 §2).
       */
      if (target.role === "owner" && role !== "owner" && owners.length === 1)
        return fail(409, "ORGANIZATION_LAST_OWNER");

      state.seen.roles.push({ organizationId, userId, role });
      state.memberships = state.memberships.map((row) =>
        row.organizationId === organizationId && row.userId === userId
          ? { ...row, role }
          : row,
      );

      return new Response(null, { status: 204 });
    },
  ),

  http.delete(`${API}/orgs/:orgId/members/:userId`, ({ params }): Response => {
    const organizationId = String(params["orgId"]);
    const userId = String(params["userId"]);

    if (membershipOf(state, organizationId) === undefined)
      return fail(404, "NOT_FOUND");

    const target = state.memberships.find(
      (row) => row.organizationId === organizationId && row.userId === userId,
    );

    if (target === undefined) return fail(404, "NOT_FOUND");

    // Removal and leaving are one write with one invariant; which of the two
    // it is only changes who was allowed to ask (ADR-0067 §2).
    if (target.role === "owner" && ownersOf(state, organizationId).length === 1)
      return fail(409, "ORGANIZATION_LAST_OWNER");

    state.seen.removed.push({ organizationId, userId });
    state.memberships = state.memberships.filter(
      (row) =>
        !(row.organizationId === organizationId && row.userId === userId),
    );

    // Leaving takes the organization out of the caller's own list, which is
    // the half of this write the switcher can see.
    if (userId === CALLER.id)
      state.organizations = state.organizations.filter(
        (row) => row.id !== organizationId,
      );

    return new Response(null, { status: 204 });
  }),

  http.get(
    `${API}/orgs/:orgId/invitations`,
    ({ params, request }): Response => {
      const organizationId = String(params["orgId"]);
      const organization = membershipOf(state, organizationId);

      if (organization === undefined) return fail(404, "NOT_FOUND");

      const refusal = requireRole(organization, "owner", "admin");

      if (refusal !== null) return refusal;

      const query = parseListSearch(request.url, listInvitationsQuery);
      const rows = state.invitations.filter(
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
    `${API}/orgs/:orgId/invitations`,
    async ({ params, request }): Promise<Response> => {
      const organizationId = String(params["orgId"]);
      const organization = membershipOf(state, organizationId);

      if (organization === undefined) return fail(404, "NOT_FOUND");

      const refusal = requireRole(organization, "owner", "admin");

      if (refusal !== null) return refusal;

      /*
       * A personal organization has one member by construction, so the service
       * refuses every invitation into one before anything else is considered
       * (ADR-0067 §2). Modelled after a review finding: without it the suite
       * certified an invite dialog the API answers `409` to, on the one screen
       * every account starts with.
       */
      if (organization.kind === "personal")
        return fail(409, "ORGANIZATION_PERSONAL_CLOSED");

      const body = createInvitationBody.parse(await request.json());

      /*
       * One pending invitation per address per organization. The refusal names
       * no account and looks the same whether or not the address has one, which
       * is what keeps the flow enumeration-safe (ADR-0020 §Enumeration).
       */
      if (
        state.invitations.some(
          (row) =>
            row.organizationId === organizationId && row.email === body.email,
        )
      )
        return fail(409, "ORGANIZATION_INVITATION_PENDING");

      state.seen.invited.push({ organizationId, body });

      const created: InvitationResource = {
        id: `0198c1f0-0000-7000-8000-000000${state.invitations.length}e900`,
        organizationId,
        organizationName: organization.name,
        email: body.email,
        role: body.role,
        // Derived from the timestamps rather than stored, which is why the mock
        // computes it too rather than accepting one from a caller.
        status: "pending",
        expiresAt: "2026-09-30T10:00:00.000Z",
        createdAt: "2026-09-05T12:00:00.000Z",
      };

      state.invitations = [...state.invitations, created];

      /*
       * **No token comes back, and nothing here mints one.** The row's
       * `token_hash` is written by the API and read by nothing in D15
       * (ADR-0067 §2 as amended): the resource has no field for it, and a mock
       * that invented one would be describing an endpoint that does not exist.
       */
      return ok(created, 201);
    },
  ),

  http.delete(`${API}/orgs/:orgId/invitations/:id`, ({ params }): Response => {
    const organizationId = String(params["orgId"]);
    const id = String(params["id"]);
    const organization = membershipOf(state, organizationId);

    if (organization === undefined) return fail(404, "NOT_FOUND");

    const refusal = requireRole(organization, "owner", "admin");

    if (refusal !== null) return refusal;

    /*
     * Scoped to the organization in the path and not to the id alone (a review
     * finding): the API reads the row inside the tenant, so a client that
     * revoked with a mismatched organization would pass a suite that matched on
     * the id and `404` in production.
     */
    const owned = (row: InvitationResource): boolean =>
      row.id === id && row.organizationId === organizationId;

    if (!state.invitations.some(owned)) return fail(404, "NOT_FOUND");

    state.seen.revoked.push({ organizationId, id });
    state.invitations = state.invitations.filter((row) => !owned(row));

    return new Response(null, { status: 204 });
  }),

  /*
   * The invitee's own three routes, outside the `/orgs/:orgId` prefix: what
   * scopes them is the caller's address, so there is nothing for a caller to
   * name but an invitation they were shown (ADR-0067 §4).
   */
  http.get(`${API}/invitations`, () => ok(state.received)),

  http.post(`${API}/invitations/:id/accept`, ({ params }): Response => {
    const id = String(params["id"]);
    const invitation = state.received.find((row) => row.id === id);

    if (invitation === undefined) return fail(404, "NOT_FOUND");

    state.seen.accepted.push(id);
    state.received = state.received.filter((row) => row.id !== id);

    const joined: OrganizationResource = {
      id: invitation.organizationId,
      slug: invitation.organizationName.toLowerCase(),
      name: invitation.organizationName,
      kind: "team",
      role: invitation.role,
      createdBy: OTHER_MEMBER_ID,
      createdAt: "2026-01-01T10:00:00.000Z",
      updatedAt: "2026-01-01T10:00:00.000Z",
      deletedAt: null,
    };

    state.organizations = [...state.organizations, joined];
    state.memberships = [
      ...state.memberships,
      {
        organizationId: joined.id,
        userId: CALLER.id,
        email: CALLER.email,
        firstName: CALLER.firstName,
        lastName: CALLER.lastName,
        role: invitation.role,
        createdAt: "2026-09-05T12:00:00.000Z",
        updatedAt: "2026-09-05T12:00:00.000Z",
      },
    ];

    /*
     * `200` with the organization joined rather than `204`: the client's next
     * act is to switch into it, and answering with it saves the round trip the
     * switcher would otherwise make (`organizations.controller.ts`).
     */
    return ok(joined);
  }),

  http.post(`${API}/invitations/:id/decline`, ({ params }): Response => {
    const id = String(params["id"]);

    if (!state.received.some((row) => row.id === id))
      return fail(404, "NOT_FOUND");

    state.seen.declined.push(id);
    state.received = state.received.filter((row) => row.id !== id);

    // Declining ends an offer and creates no membership, so nothing joins the
    // caller's organizations here.
    return new Response(null, { status: 204 });
  }),
];
