import type {
  CreateUserBody,
  ImpersonationHandoffResource,
  ListEnvelope,
  ListUsersQuery,
  Page,
  SetPasswordBody,
  SuccessEnvelope,
  UpdateUserBody,
  UserResource,
} from "@repo/contracts";

import type { ApiClient } from "@/shared/api/client";

/**
 * The user endpoints as plain typed functions (ADR-0034 §Entity API).
 *
 * Deliberately not hooks. The split is what lets ADR-0036 test them without a
 * React tree, and what lets a route loader call `ensureQueryData` with the same
 * function the hook uses.
 *
 * The envelope arrives whole: ADR-0012 emits `meta.pagination`, `meta.sort` and
 * `meta.filters` precisely so a table can render its own state without
 * re-parsing its own query, and unwrapping a list to a bare array would throw
 * that away. `list` reassembles it into the `Page<T>` contracts already define.
 */
export const createUserApi = (client: ApiClient) =>
  ({
    list: async (params: ListUsersQuery): Promise<Page<UserResource>> => {
      const { data } = await client.instance.get<ListEnvelope<UserResource>>(
        "/users",
        { params },
      );

      return {
        items: data.data,
        total: data.meta.pagination.total,
        offset: data.meta.pagination.offset,
        limit: data.meta.pagination.limit,
        sort: data.meta.sort ?? [],
        filters: data.meta.filters ?? {},
      };
    },

    get: async (id: string): Promise<UserResource> => {
      const { data } = await client.instance.get<SuccessEnvelope<UserResource>>(
        `/users/${id}`,
      );

      return data.data;
    },

    create: async (body: CreateUserBody): Promise<UserResource> => {
      const { data } = await client.instance.post<
        SuccessEnvelope<UserResource>
      >("/users", body);

      return data.data;
    },

    update: async (id: string, body: UpdateUserBody): Promise<UserResource> => {
      const { data } = await client.instance.patch<
        SuccessEnvelope<UserResource>
      >(`/users/${id}`, body);

      return data.data;
    },

    /**
     * `POST /admin/users/:id/password` — the administrative reset (ADR-0027).
     *
     * `password` is the subject's new credential and `currentPassword` is the
     * **acting** staff member's own, re-presented as ADR-0027 rule 1 requires.
     * `admin` only, never `manager`: reading the customer base is a manager's
     * job and rewriting a customer's credential is not.
     */
    setPassword: async (id: string, body: SetPasswordBody): Promise<void> => {
      await client.instance.post(`/users/${id}/password`, body);
    },

    /** `POST /admin/users/:id/sessions/revoke` — forced sign-out. `204`. */
    revokeSessions: async (id: string): Promise<void> => {
      await client.instance.post(`/users/${id}/sessions/revoke`);
    },

    /**
     * `POST /admin/users/:id/impersonate` — the mint (ADR-0057 §1, `D13.8`).
     *
     * **The response is a credential and the response alone**: a one-time
     * handoff token with a sixty-second life, and no `Set-Cookie` of any kind.
     * That absence is the design — the admin segment's cookies are never
     * written by this flow, which is what leaves the minting operator's own
     * session untouched — so nothing here touches the session store either.
     *
     * `admin` only at the guard, never `manager`; the row menu declines to
     * offer it to one (`RESOURCE_POLICY.users.impersonate`), and the router is
     * what enforces it.
     */
    impersonate: async (id: string): Promise<ImpersonationHandoffResource> => {
      const { data } = await client.instance.post<
        SuccessEnvelope<ImpersonationHandoffResource>
      >(`/users/${id}/impersonate`);

      return data.data;
    },

    /** A **soft** delete (ADR-0028): the row survives with `deletedAt` set. */
    remove: async (id: string): Promise<void> => {
      await client.instance.delete(`/users/${id}`);
    },
  }) as const;

export type UserApi = ReturnType<typeof createUserApi>;
