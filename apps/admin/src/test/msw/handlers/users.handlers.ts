import {
  createUserBody,
  filtersToRecord,
  listUsersQuery,
  setPasswordBody,
  updateUserBody,
  type CreateUserBody,
  type ListUsersQuery,
  type SetPasswordBody,
  type UpdateUserBody,
  type UserResource,
} from "@repo/contracts";
import { http, type HttpHandler } from "msw";

import { API } from "./auth.handlers";
import { fail, listOk, ok } from "./envelope";
import { parseListSearch } from "./list-query";
import { ACTOR_PASSWORD } from "./staff.handlers";

/**
 * The users endpoints, as MSW answers them (ADR-0036 §The load-bearing rule).
 *
 * Every request is parsed with the schema the API validates with and every
 * response is built by the envelope helpers, so a contract change stops this
 * compiling or starts it throwing.
 *
 * Two behaviours are implemented rather than stubbed, because the UI's claims
 * depend on them: **the soft delete keeps the row** (`deletedAt` set, `status`
 * written to `disabled` — ADR-0028's three writes, minus the sessions this app
 * cannot see), and **the default scope hides deleted accounts** unless
 * `filter[deletedAt][null]=false` asks for them. A mock that dropped the row on
 * delete would let the suite certify the opposite of what the API does, which
 * is the failure this file's construction exists to prevent.
 */

export const USER_ROWS: readonly UserResource[] = [
  {
    id: "0198c2f0-0000-7000-8000-000000000001",
    email: "cara@example.test",
    firstName: "Cara",
    lastName: "Customer",
    status: "active",
    roles: ["customer"],
    lastLoginAt: "2026-08-18T12:00:00.000Z",
    createdAt: "2026-04-02T10:00:00.000Z",
    updatedAt: "2026-08-18T12:00:00.000Z",
    deletedAt: null,
  },
  {
    id: "0198c2f0-0000-7000-8000-000000000002",
    email: "pat@example.test",
    // Nullable on the wire, and the grid has to render the gap rather than the
    // string "null" (ADR-0017: `users.first_name` is nullable).
    firstName: null,
    lastName: null,
    status: "pending_verification",
    roles: ["customer"],
    lastLoginAt: null,
    createdAt: "2026-05-19T10:00:00.000Z",
    updatedAt: "2026-05-19T10:00:00.000Z",
    deletedAt: null,
  },
  {
    id: "0198c2f0-0000-7000-8000-000000000003",
    email: "gone@example.test",
    firstName: "Gone",
    lastName: "Away",
    // Soft-deleted, and `status` is written too — so `filter[status][eq]=active`
    // stays a truthful filter (ADR-0028).
    status: "disabled",
    roles: ["customer"],
    lastLoginAt: "2026-06-01T09:00:00.000Z",
    createdAt: "2026-03-08T10:00:00.000Z",
    updatedAt: "2026-07-15T10:00:00.000Z",
    deletedAt: "2026-07-15T10:00:00.000Z",
  },
];

export interface UsersMockState {
  rows: UserResource[];
  actorPassword: string;
  readonly seen: {
    list: ListUsersQuery[];
    created: CreateUserBody[];
    updated: { id: string; body: UpdateUserBody }[];
    passwords: { id: string; body: SetPasswordBody }[];
    revoked: string[];
    deleted: string[];
  };
}

export const createUsersMockState = (
  rows: readonly UserResource[] = USER_ROWS,
): UsersMockState => ({
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

const matchesSearch = (user: UserResource, term: string): boolean =>
  [user.email, user.firstName ?? "", user.lastName ?? ""].some((value) =>
    value.toLowerCase().includes(term.toLowerCase()),
  );

const valueOf = (user: UserResource, field: string): string =>
  String((user as unknown as Record<string, unknown>)[field] ?? "");

const applyQuery = (
  rows: readonly UserResource[],
  query: ListUsersQuery,
): readonly UserResource[] => {
  const deletedFilter = query.filters.find(
    (filter) => filter.field === "deletedAt" && filter.op === "null",
  );

  /*
   * The default scope, and the reason the "show deleted" toggle is a filter
   * rather than a column the operator ignores: with no opinion in the query,
   * deleted accounts are absent. `null: false` asks for the ones that *have* a
   * `deletedAt`, which is the request the checkbox writes.
   */
  let result = rows.filter((user) =>
    deletedFilter === undefined
      ? user.deletedAt === null
      : deletedFilter.value === true
        ? user.deletedAt === null
        : user.deletedAt !== null,
  );

  if (query.q !== undefined)
    result = result.filter((user) => matchesSearch(user, query.q ?? ""));

  for (const filter of query.filters) {
    if (filter.op === "eq")
      result = result.filter(
        (user) => valueOf(user, filter.field) === String(filter.value),
      );
  }

  for (const { field, direction } of [...query.sort].reverse()) {
    result = [...result].sort((left, right) =>
      direction === "desc"
        ? valueOf(right, field).localeCompare(valueOf(left, field))
        : valueOf(left, field).localeCompare(valueOf(right, field)),
    );
  }

  return result;
};

/** Every write refuses a soft-deleted subject with `409` (ADR-0028). */
const refusedIfDeleted = (user: UserResource | undefined): Response | null => {
  if (user === undefined) return fail(404, "NOT_FOUND");

  return user.deletedAt === null ? null : fail(409, "USER_DELETED");
};

export const createUsersHandlers = (state: UsersMockState) =>
  [
    http.get(`${API}/users`, ({ request }): Response => {
      const query = parseListSearch(request.url, listUsersQuery);

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

    // Reads keep working on a deleted account: an admin who can list them must
    // be able to open one, and a `404` for a row they were just shown is the
    // worse lie (ADR-0028).
    http.get(`${API}/users/:id`, ({ params }): Response => {
      const user = state.rows.find((row) => row.id === params["id"]);

      return user === undefined ? fail(404, "NOT_FOUND") : ok(user);
    }),

    http.post(`${API}/users`, async ({ request }): Promise<Response> => {
      const body = createUserBody.parse(await request.json());

      state.seen.created.push(body);

      /*
       * Only a **live** row holds the address. The partial unique index
       * (`where deleted_at is null`) is what releases a deleted account's
       * email for re-registration, and this is where the UI's claim that it
       * does gets tested rather than asserted.
       */
      if (
        state.rows.some(
          (row) => row.email === body.email && row.deletedAt === null,
        )
      )
        return fail(409, "USER_EMAIL_TAKEN");

      const created: UserResource = {
        id: `0198c2f0-0000-7000-8000-${String(state.rows.length + 1).padStart(12, "0")}`,
        email: body.email,
        firstName: body.firstName ?? null,
        lastName: body.lastName ?? null,
        status: body.status ?? "active",
        roles: body.roles ?? ["customer"],
        lastLoginAt: null,
        createdAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-08-20T10:00:00.000Z",
        deletedAt: null,
      };

      state.rows = [...state.rows, created];

      return ok(created, 201);
    }),

    http.patch(
      `${API}/users/:id`,
      async ({ params, request }): Promise<Response> => {
        const id = String(params["id"]);
        const body = updateUserBody.parse(await request.json());
        const existing = state.rows.find((row) => row.id === id);

        state.seen.updated.push({ id, body });

        const refused = refusedIfDeleted(existing);
        if (refused !== null || existing === undefined)
          return refused ?? fail(404, "NOT_FOUND");

        // Key by key rather than `...body`: zod omits absent optional keys, but
        // `exactOptionalPropertyTypes` cannot say so in the type — and here
        // `null` is a real value to write, not an absence.
        const updated: UserResource = {
          ...existing,
          ...(body.firstName === undefined
            ? {}
            : { firstName: body.firstName }),
          ...(body.lastName === undefined ? {} : { lastName: body.lastName }),
          ...(body.status === undefined ? {} : { status: body.status }),
          ...(body.roles === undefined ? {} : { roles: body.roles }),
          updatedAt: "2026-08-20T10:00:00.000Z",
        };

        state.rows = state.rows.map((row) => (row.id === id ? updated : row));

        return ok(updated);
      },
    ),

    http.post(
      `${API}/users/:id/password`,
      async ({ params, request }): Promise<Response> => {
        const id = String(params["id"]);
        const body = setPasswordBody.parse(await request.json());

        state.seen.passwords.push({ id, body });

        /*
         * The actor's own password **first**, which is the order the service
         * takes and takes deliberately: a wrong one then answers the same `403`
         * whether or not the id exists, so the endpoint is not an enumeration
         * oracle, and no argon2 hash is bought for a request that is about to
         * be refused anyway (ADR-0027, ADR-0020). Checking the subject's state
         * first would answer a fact about another account to a caller who has
         * not proved who they are — and would quietly teach this suite the
         * wrong order.
         */
        if (body.currentPassword !== state.actorPassword)
          return fail(403, "AUTH_CURRENT_PASSWORD_INVALID");

        const refused = refusedIfDeleted(
          state.rows.find((row) => row.id === id),
        );
        if (refused !== null) return refused;

        return new Response(null, { status: 204 });
      },
    ),

    http.post(`${API}/users/:id/sessions/revoke`, ({ params }): Response => {
      const id = String(params["id"]);

      state.seen.revoked.push(id);

      const refused = refusedIfDeleted(state.rows.find((row) => row.id === id));

      return refused ?? new Response(null, { status: 204 });
    }),

    /*
     * The soft delete's three writes (ADR-0028), as far as this app can see
     * them: `deletedAt` set, `status` written to `disabled`, sessions revoked
     * (invisible here — no session resource is exposed). **The row survives**,
     * which is the whole difference from the staff endpoint and the thing the
     * grid then has to render.
     */
    http.delete(`${API}/users/:id`, ({ params }): Response => {
      const id = String(params["id"]);

      state.seen.deleted.push(id);

      /*
       * A second delete is a `409`, not a no-op reported as success: the
       * service refuses it rather than moving the timestamp (ADR-0028), and
       * `softDelete` matches a live row only. This handler is the one place the
       * suite can get that wrong, and it matters more here than anywhere else —
       * `useUserRowActions` deliberately leaves **Delete** enabled on a row
       * carrying `deletedAt`, on the argument that the API is the enforcement
       * point. A mock that answered `204` would certify the opposite of what
       * production does, on precisely the flow that argument rests on.
       */
      const refused = refusedIfDeleted(state.rows.find((row) => row.id === id));
      if (refused !== null) return refused;

      state.rows = state.rows.map((row) =>
        row.id === id
          ? {
              ...row,
              status: "disabled",
              deletedAt: "2026-08-20T10:00:00.000Z",
              updatedAt: "2026-08-20T10:00:00.000Z",
            }
          : row,
      );

      return new Response(null, { status: 204 });
    }),
  ] as const satisfies readonly HttpHandler[];
