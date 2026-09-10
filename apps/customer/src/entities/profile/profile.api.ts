import type {
  ChangeEmailBody,
  ChangePasswordBody,
  DeleteProfileBody,
  SuccessEnvelope,
  UpdateProfileBody,
  UserResource,
} from "@repo/contracts";

import type { ApiClient } from "@/shared/api/client";

/**
 * `/api/v1/user/profile` as plain typed functions (ADR-0034 §Entity API).
 *
 * The caller's own account, and a **singleton**: there is no `:id` on any of
 * these routes because the subject is `ctx.principal` (ADR-0027, ADR-0019 §3).
 * That is the structural fact this whole slice is shaped by — no list, no
 * detail-by-id, one cache entry.
 *
 * The resource it returns is a `UserResource`, the same shape
 * `/admin/users` emits, because it is the same aggregate seen from the other
 * side (ADR-0012). This app will never see the admin's view of it, and reusing
 * the type rather than declaring a second one is what keeps that true.
 *
 * **The paths are the ones the API shipped at D2.3/D2.4, not the ones ADR-0055
 * §4 first spelled.** That record said `POST /profile/password`; the shipped
 * route is `/profile/change-password`, the staff mirror's spelling, and §4 was
 * amended at `D12.2` to say so. A client that wrote the record's spelling would
 * have been a 404 with an ADR to blame.
 */
export const createProfileApi = (client: ApiClient) =>
  ({
    get: async (): Promise<UserResource> => {
      const { data } =
        await client.instance.get<SuccessEnvelope<UserResource>>("/profile");

      return data.data;
    },

    /**
     * `PATCH /user/profile` — names only.
     *
     * `updateProfileBody` carries no `roles`, no `status` and no `email`, and
     * that is what makes the endpoint safe rather than merely convenient: a
     * customer sending `status` is refused as an unknown key by the schema, so
     * a self-reactivation fails on the contract instead of on a rule somebody
     * has to remember to write. There is nothing for this function to filter.
     *
     * Both names are `nullable` here where the staff mirror's are not, because
     * `users.first_name` is nullable and the staff table's is not (ADR-0017):
     * "clear it" is a legal request on this segment and has to be expressible.
     */
    update: async (body: UpdateProfileBody): Promise<UserResource> => {
      const { data } = await client.instance.patch<
        SuccessEnvelope<UserResource>
      >("/profile", body);

      return data.data;
    },

    /**
     * `POST /user/profile/change-password` — the account changing its own
     * credential (ADR-0027 §Self-service). `204`.
     *
     * Both passwords in the body belong to **this** customer, which is the
     * whole reason the current one is re-presented despite a valid session: a
     * stolen access token is worth fifteen minutes and one that can set a new
     * password is worth the account. Every *other* session is revoked and this
     * one is not. No count comes back; how many devices were signed out is not
     * something the answer needs to say.
     */
    changePassword: async (body: ChangePasswordBody): Promise<void> => {
      await client.instance.post("/profile/change-password", body);
    },

    /**
     * `POST /user/profile/change-email` — asking to move to a new address
     * (`D18.9`; ADR-0071 §6). `202`.
     *
     * **Nothing has changed when this resolves**, which is the one thing a
     * caller must not get wrong about it. The API mails a confirmation link to
     * `newEmail` and leaves the account exactly as it was; the address moves
     * only when somebody follows that link, on `/confirm-email`, possibly on
     * another device and possibly an hour later. So there is no resource to
     * return and nothing of this entity's to invalidate.
     *
     * The current password is in the body for `changePassword`'s reason, taken
     * further: a changed address redirects every future recovery link, so a
     * stolen access token that could move one would be worth the account.
     * There is no `:id` here either — the only account this can ever move is
     * the caller's (ADR-0019 §3).
     */
    changeEmail: async (body: ChangeEmailBody): Promise<void> => {
      await client.instance.post("/profile/change-email", body);
    },

    /**
     * `DELETE /user/profile` — the account closing itself (`D12.8`; ADR-0055
     * §4, ADR-0028's user semantics). `204`.
     *
     * **A `DELETE` with a body**, which is unusual and is the endpoint's own
     * decision rather than this client's: the actor re-authenticates, and a
     * presented credential cannot go in a query string that every proxy
     * between the browser and the process logs. `data` is how axios carries a
     * body on a method whose shorthand has no body parameter.
     *
     * There is no `:id`, so the only account this can ever close is the
     * caller's (ADR-0019 §3) — the same structural fact the rest of this
     * slice rests on, at its most load-bearing.
     *
     * The response ends **every** session including this one and clears the
     * auth cookies (ADR-0055 §4 as amended at `D12.4`), which is the line
     * between this and `changePassword` above: there the caller's session is
     * deliberately spared, here there is no account left to be signed in to.
     * Ending the *client's* half of that is the caller's job, because it is a
     * session decision rather than a request one.
     */
    remove: async (body: DeleteProfileBody): Promise<void> => {
      await client.instance.delete("/profile", { data: body });
    },
  }) as const;

export type ProfileApi = ReturnType<typeof createProfileApi>;
