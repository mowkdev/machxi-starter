import type {
  ChangePasswordBody,
  StaffResource,
  SuccessEnvelope,
  UpdateStaffProfileBody,
} from "@repo/contracts";

import type { ApiClient } from "@/shared/api/client";

/**
 * `/api/v1/admin/profile` as plain typed functions (ADR-0034 §Entity API).
 *
 * The caller's own account, and a **singleton**: there is no `:id` on any of
 * these routes because the subject is `ctx.principal` (ADR-0027, ADR-0019 §3).
 * That is the one structural difference from `staff.api.ts` and it runs all the
 * way through this slice — no list, no detail-by-id, one cache entry.
 *
 * The resource it returns is a `StaffResource`, the same shape `/admin/staff`
 * emits, because it is the same aggregate seen from the other side: the staff
 * module owns both controllers over one service, which is exactly why this app
 * gets to reuse the type rather than declare a second one.
 */
export const createProfileApi = (client: ApiClient) =>
  ({
    get: async (): Promise<StaffResource> => {
      const { data } =
        await client.instance.get<SuccessEnvelope<StaffResource>>("/profile");

      return data.data;
    },

    /**
     * `PATCH /admin/profile` — names only.
     *
     * `updateStaffProfileBody` carries no `roles`, no `status` and no `email`,
     * and ADR-0027 §Contracts (amended D2.3) is explicit that this is what
     * makes an unguarded router safe rather than merely convenient: an `editor`
     * sending `roles` is refused as an unknown key by the schema, so the
     * escalation fails on the contract instead of on a rule somebody has to
     * remember to write. There is nothing for this function to filter.
     */
    update: async (body: UpdateStaffProfileBody): Promise<StaffResource> => {
      const { data } = await client.instance.patch<
        SuccessEnvelope<StaffResource>
      >("/profile", body);

      return data.data;
    },

    /**
     * `POST /admin/profile/change-password` — the account changing its own
     * credential (ADR-0027 §Staff self-service). `204`.
     *
     * Both passwords in the body belong to **this** operator, which is the
     * whole difference from `staff.setPassword`: the current one is
     * re-presented because a stolen access token is worth fifteen minutes and
     * one that can set a new password is worth the account. Every *other*
     * session is revoked and this one is not — the caller just proved they own
     * it. No count comes back; how many devices were signed out is not
     * something the answer needs to say.
     */
    changePassword: async (body: ChangePasswordBody): Promise<void> => {
      await client.instance.post("/profile/change-password", body);
    },
  }) as const;

export type ProfileApi = ReturnType<typeof createProfileApi>;
