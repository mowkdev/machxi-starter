import type {
  CreateStaffBody,
  ListEnvelope,
  ListStaffQuery,
  Page,
  SetEmailBody,
  SetPasswordBody,
  StaffResource,
  SuccessEnvelope,
  UpdateStaffBody,
} from "@repo/contracts";

import type { ApiClient } from "@/shared/api/client";

/**
 * The staff endpoints as plain typed functions (ADR-0034 §Entity API).
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
export const createStaffApi = (client: ApiClient) =>
  ({
    list: async (params: ListStaffQuery): Promise<Page<StaffResource>> => {
      const { data } = await client.instance.get<ListEnvelope<StaffResource>>(
        "/staff",
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

    get: async (id: string): Promise<StaffResource> => {
      const { data } = await client.instance.get<
        SuccessEnvelope<StaffResource>
      >(`/staff/${id}`);

      return data.data;
    },

    create: async (body: CreateStaffBody): Promise<StaffResource> => {
      const { data } = await client.instance.post<
        SuccessEnvelope<StaffResource>
      >("/staff", body);

      return data.data;
    },

    update: async (
      id: string,
      body: UpdateStaffBody,
    ): Promise<StaffResource> => {
      const { data } = await client.instance.patch<
        SuccessEnvelope<StaffResource>
      >(`/staff/${id}`, body);

      return data.data;
    },

    /**
     * `POST /admin/staff/:id/password` — the administrative reset (ADR-0027).
     *
     * The two passwords in the body belong to two different people: `password`
     * is the subject's new credential and `currentPassword` is the **acting**
     * staff member's own, re-presented as the step-up ADR-0027 rule 1 requires.
     * `204`, with no count of the sessions it revoked — how many devices the
     * account was signed in on is not the caller's business.
     */
    setPassword: async (id: string, body: SetPasswordBody): Promise<void> => {
      await client.instance.post(`/staff/${id}/password`, body);
    },

    /**
     * `POST /admin/staff/:id/email` — a super admin sets the address
     * (`D18.10`, ADR-0071 §7).
     *
     * The users twin, and the one route under `/admin/staff` that narrows the
     * resource's `admin` mount to `super_admin`. `currentPassword` is the
     * acting operator's own. `204`, and **no session is revoked** — an address
     * is not a credential, so the operator whose address moved stays signed in.
     */
    setEmail: async (id: string, body: SetEmailBody): Promise<void> => {
      await client.instance.post(`/staff/${id}/email`, body);
    },

    /** `POST /admin/staff/:id/sessions/revoke` — forced sign-out. `204`. */
    revokeSessions: async (id: string): Promise<void> => {
      await client.instance.post(`/staff/${id}/sessions/revoke`);
    },

    remove: async (id: string): Promise<void> => {
      await client.instance.delete(`/staff/${id}`);
    },
  }) as const;

export type StaffApi = ReturnType<typeof createStaffApi>;
