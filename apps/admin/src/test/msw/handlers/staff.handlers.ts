import {
  createStaffBody,
  filtersToRecord,
  listStaffQuery,
  setPasswordBody,
  updateStaffBody,
  type CreateStaffBody,
  type ListStaffQuery,
  type SetPasswordBody,
  type StaffResource,
  type UpdateStaffBody,
} from "@repo/contracts";
import { http, type HttpHandler } from "msw";

import { API } from "./auth.handlers";
import { fail, listOk, ok } from "./envelope";
import { parseListSearch } from "./list-query";

/**
 * The staff endpoints, as MSW answers them (ADR-0036 §The load-bearing rule).
 *
 * Every request is parsed with the schema the API validates with and every
 * response is built by the envelope helpers, so a contract change stops this
 * compiling or starts it throwing rather than letting the suite certify against
 * an API the frontend wishes it had. That is what makes the assertions below
 * about *this* API instead of about a fixture.
 *
 * The endpoint's own semantics are implemented only as far as the UI can
 * observe them — `q`, an `eq` filter, `sort` and the page window, because those
 * are what the grid drives and what `meta.pagination.total` has to be honest
 * about. Anything deeper would be re-implementing the API, which is the mock
 * fidelity ADR-0036 warns against buying.
 *
 * `create*Handlers(state)` with no shared module state: a test that needs a
 * scripted refusal builds its own handler and `server.use()`es it.
 */

export const STAFF_ROWS: readonly StaffResource[] = [
  {
    id: "0198c1f0-0000-7000-8000-000000000001",
    email: "ada@machxi.local",
    firstName: "Ada",
    lastName: "Admin",
    status: "active",
    roles: ["super_admin"],
    lastLoginAt: "2026-08-19T09:30:00.000Z",
    createdAt: "2026-01-04T10:00:00.000Z",
    updatedAt: "2026-08-19T09:30:00.000Z",
  },
  {
    id: "0198c1f0-0000-7000-8000-000000000002",
    email: "mo@machxi.local",
    firstName: "Mo",
    lastName: "Manager",
    status: "active",
    roles: ["manager"],
    lastLoginAt: null,
    createdAt: "2026-02-11T10:00:00.000Z",
    updatedAt: "2026-02-11T10:00:00.000Z",
  },
  {
    id: "0198c1f0-0000-7000-8000-000000000003",
    email: "eve@machxi.local",
    firstName: "Eve",
    lastName: "Editor",
    status: "disabled",
    roles: ["editor"],
    lastLoginAt: "2026-07-02T08:00:00.000Z",
    createdAt: "2026-03-21T10:00:00.000Z",
    updatedAt: "2026-07-02T08:00:00.000Z",
  },
];

/** The acting admin's own password, for ADR-0027's step-up check. */
export const ACTOR_PASSWORD = "DevPassword!123";

export interface StaffMockState {
  rows: StaffResource[];
  actorPassword: string;
  /** What the client actually asked for, for assertions that need the wire. */
  readonly seen: {
    list: ListStaffQuery[];
    created: CreateStaffBody[];
    updated: { id: string; body: UpdateStaffBody }[];
    passwords: { id: string; body: SetPasswordBody }[];
    revoked: string[];
    deleted: string[];
  };
}

export const createStaffMockState = (
  rows: readonly StaffResource[] = STAFF_ROWS,
): StaffMockState => ({
  rows: [...rows],
  actorPassword: ACTOR_PASSWORD,
  seen: {
    list: [],
    created: [],
    updated: [],
    passwords: [],
    revoked: [],
    deleted: [],
  },
});

const matchesSearch = (staff: StaffResource, term: string): boolean =>
  [staff.email, staff.firstName, staff.lastName].some((value) =>
    value.toLowerCase().includes(term.toLowerCase()),
  );

const valueOf = (staff: StaffResource, field: string): string =>
  String((staff as unknown as Record<string, unknown>)[field] ?? "");

const applyQuery = (
  rows: readonly StaffResource[],
  query: ListStaffQuery,
): readonly StaffResource[] => {
  let result = [...rows];

  if (query.q !== undefined)
    result = result.filter((staff) => matchesSearch(staff, query.q ?? ""));

  for (const filter of query.filters) {
    if (filter.op === "eq")
      result = result.filter(
        (staff) => valueOf(staff, filter.field) === String(filter.value),
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

export const createStaffHandlers = (state: StaffMockState) =>
  [
    http.get(`${API}/staff`, ({ request }): Response => {
      // The endpoint's own schema. A `sort` field or an operator the contract
      // does not allow-list throws here, in the test, rather than reaching an
      // operator as a `VALIDATION_ERROR`.
      const query = parseListSearch(request.url, listStaffQuery);

      state.seen.list.push(query);

      const matched = applyQuery(state.rows, query);

      return listOk({
        items: matched.slice(query.offset, query.offset + query.limit),
        total: matched.length,
        offset: query.offset,
        limit: query.limit,
        sort: query.sort,
        filters: filtersToRecord(query.filters),
      });
    }),

    http.get(`${API}/staff/:id`, ({ params }): Response => {
      const staff = state.rows.find((row) => row.id === params["id"]);

      return staff === undefined ? fail(404, "NOT_FOUND") : ok(staff);
    }),

    http.post(`${API}/staff`, async ({ request }): Promise<Response> => {
      const body = createStaffBody.parse(await request.json());

      state.seen.created.push(body);

      if (state.rows.some((row) => row.email === body.email))
        return fail(409, "STAFF_EMAIL_TAKEN");

      const created: StaffResource = {
        id: `0198c1f0-0000-7000-8000-${String(state.rows.length + 1).padStart(12, "0")}`,
        email: body.email,
        firstName: body.firstName,
        lastName: body.lastName,
        status: "active",
        roles: body.roles,
        lastLoginAt: null,
        createdAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-08-20T10:00:00.000Z",
      };

      state.rows = [...state.rows, created];

      return ok(created, 201);
    }),

    http.patch(
      `${API}/staff/:id`,
      async ({ params, request }): Promise<Response> => {
        const id = String(params["id"]);
        const body = updateStaffBody.parse(await request.json());
        const existing = state.rows.find((row) => row.id === id);

        state.seen.updated.push({ id, body });

        if (existing === undefined) return fail(404, "NOT_FOUND");

        /*
         * Spread key by key rather than `...body`. zod omits an absent optional
         * key rather than setting it `undefined`, so the wholesale spread is
         * right at runtime — but under `exactOptionalPropertyTypes` the *type*
         * cannot say so, and the honest fix is four lines, not a cast that
         * would also hide a real mismatch later.
         */
        const updated: StaffResource = {
          ...existing,
          ...(body.firstName === undefined
            ? {}
            : { firstName: body.firstName }),
          ...(body.lastName === undefined ? {} : { lastName: body.lastName }),
          ...(body.roles === undefined ? {} : { roles: body.roles }),
          ...(body.status === undefined ? {} : { status: body.status }),
          updatedAt: "2026-08-20T10:00:00.000Z",
        };

        state.rows = state.rows.map((row) => (row.id === id ? updated : row));

        return ok(updated);
      },
    ),

    http.post(
      `${API}/staff/:id/password`,
      async ({ params, request }): Promise<Response> => {
        const id = String(params["id"]);
        const body = setPasswordBody.parse(await request.json());

        state.seen.passwords.push({ id, body });

        // ADR-0027 rule 1: the actor re-presents their own password, and a
        // wrong one is the same `403` the self-service endpoints answer.
        if (body.currentPassword !== state.actorPassword)
          return fail(403, "AUTH_CURRENT_PASSWORD_INVALID");

        return new Response(null, { status: 204 });
      },
    ),

    http.post(`${API}/staff/:id/sessions/revoke`, ({ params }): Response => {
      state.seen.revoked.push(String(params["id"]));

      return new Response(null, { status: 204 });
    }),

    http.delete(`${API}/staff/:id`, ({ params }): Response => {
      const id = String(params["id"]);

      state.seen.deleted.push(id);
      state.rows = state.rows.filter((row) => row.id !== id);

      return new Response(null, { status: 204 });
    }),
  ] as const satisfies readonly HttpHandler[];
