import type {
  ChangeEmailBody,
  ChangePasswordBody,
  DeleteProfileBody,
  FederatedProvider,
  FederatedStartBody,
  ImpersonatorResource,
  UnlinkIdentityBody,
  UpdateProfileBody,
  UserPrincipalResource,
  UserResource,
} from "@repo/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  useApiClient,
  useSession,
  useSetPrincipal,
} from "@/shared/api/context";
import { CREDENTIAL_MUTATION } from "@/shared/api/credential-mutation";

import { createProfileApi } from "./profile.api";
import { profileKeys } from "./profile.keys";

/**
 * The profile hooks (ADR-0034 as carried by ADR-0043).
 *
 * The same invalidation rule every entity follows — invalidate what this write
 * could have changed the response of — reduced to its smallest case: there is
 * one cache entry, so both mutations invalidate `profileKeys.all` and there is
 * nothing else of this entity's to name.
 *
 * **And nothing else of any other entity's either**, which is the one place
 * this slice is shorter than the admin's. There, a profile write also changes
 * the operator's own row in the staff grid, so `features/profile-manage` owns a
 * cross-entity invalidation the entity layer may not reach. This app has no
 * second view of the account — ADR-0055 §3 mounts no grid — so the hook that
 * would carry it has nothing to invalidate and is not written.
 */

const useApi = () => createProfileApi(useApiClient());

export const useProfile = () => {
  const api = useApi();

  return useQuery({
    queryKey: profileKeys.detail(),
    queryFn: () => api.get(),
  });
};

/**
 * `errorToast: false`: both of these are submitted from a form that renders its
 * failures inline (ADR-0034). A toast repeating what is already under the field
 * is the duplication the global policy exists to avoid, not an extra courtesy.
 */
const FORM_MUTATION_META = { errorToast: false } as const;

/**
 * The customer as the session's principal.
 *
 * Rebuilt from the response rather than spread over the principal already in
 * the store, so a stale field cannot survive the update, and `kind` is `"user"`
 * because this app talks to the `/user` segment and nothing else can answer
 * here (ADR-0015).
 *
 * **Amended at `D13.6`: the actor is carried, because it is the one thing the
 * profile resource does not know.** The paragraph above used to end "everything
 * the wire principal carries is on the resource", and since `D13.5` that is
 * false: `impersonatedBy` is set by the API from the session row (ADR-0057 §4)
 * and `UserResource` has no such field, while `PATCH /user/profile` is
 * deliberately *not* on the exclusion list, so it is reachable inside an
 * impersonated session. Rebuilding without the actor would drop it mid-session
 * — the banner ADR-0057 §7 renders from that field and nothing else would
 * vanish while the operator went on acting as the customer, and `D13.6`'s cache
 * boundary would read the same session as a new principal and wipe the cache
 * under it. A profile write cannot change who is acting, so it is passed
 * through rather than re-derived.
 */
const toPrincipal = (
  user: UserResource,
  impersonatedBy: ImpersonatorResource | undefined,
): UserPrincipalResource => ({
  kind: "user",
  id: user.id,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  roles: user.roles,
  ...(impersonatedBy === undefined ? {} : { impersonatedBy }),
});

export const useUpdateProfile = () => {
  const api = useApi();
  const queryClient = useQueryClient();
  const setPrincipal = useSetPrincipal();
  const { principal } = useSession();

  return useMutation({
    mutationFn: (body: UpdateProfileBody) => api.update(body),
    meta: { ...FORM_MUTATION_META, success: "profile:outcomes.updated" },
    onSuccess: (profile) => {
      void queryClient.invalidateQueries({ queryKey: profileKeys.all });
      /*
       * The name in the header's account control is this account's, and it just
       * changed. The control reads the session store rather than this query
       * (ADR-0033 §The session store), so without this line a customer would
       * rename themselves and go on being greeted by the old name until the
       * next refresh rotated the principal.
       *
       * `useSetPrincipal` is the narrowed door's, so a `staff` principal cannot
       * be written here even by accident.
       */
      setPrincipal(
        toPrincipal(
          profile,
          principal?.kind === "user" ? principal.impersonatedBy : undefined,
        ),
      );
    },
  });
};

/**
 * `POST /user/profile/change-password` (ADR-0027 §Self-service).
 *
 * `CREDENTIAL_MUTATION` for the reason the admin's carries it: the customer's
 * old *and* new passwords are this mutation's `variables`, and without
 * `gcTime: 0` they outlive the dialog that collected them by five minutes.
 *
 * It invalidates the profile because the password write stamps `updatedAt` on
 * the row, which is the same test every other mutation here answers: does the
 * response of a cached query change because of this write?
 *
 * It does **not** touch the session. ADR-0027 spares the caller's session
 * precisely because the caller proved ownership by presenting the current
 * password, so the access token in memory stays valid and this screen stays
 * signed in — while every other device is signed out at its next request. The
 * absence of a `client.endSession()` here is the decision, not an oversight,
 * and it is the line that separates this from `D12.8`'s deletion, where every
 * session goes including this one.
 */
export const useChangePassword = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    ...CREDENTIAL_MUTATION,
    mutationFn: (body: ChangePasswordBody) => api.changePassword(body),
    meta: {
      ...FORM_MUTATION_META,
      success: "profile:outcomes.passwordChanged",
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: profileKeys.all });
    },
  });
};

/**
 * `POST /user/profile/change-email` (`D18.9`; ADR-0071 §6).
 *
 * `CREDENTIAL_MUTATION` for the reason its two neighbours carry it: the
 * customer's current password is this mutation's `variables`, and without
 * `gcTime: 0` it outlives the dialog that collected it by five minutes.
 *
 * **It invalidates nothing, and that is the whole shape of this flow.** The
 * standing rule in this slice is "invalidate what this write could have
 * changed the response of", and the answer here is *nothing*: the account is
 * untouched until a link in a mailbox is followed. Invalidating the profile
 * would refetch an unchanged row and, worse, suggest to the next reader that
 * this call moves an address. What changes the cached profile is
 * `/confirm-email`, which is a different screen on a different segment and
 * refetches for itself.
 *
 * The success sentence says the same thing in the customer's language: a link
 * is on its way, and nothing has changed yet.
 */
export const useChangeEmail = () => {
  const api = useApi();

  return useMutation({
    ...CREDENTIAL_MUTATION,
    mutationFn: (body: ChangeEmailBody) => api.changeEmail(body),
    meta: {
      ...FORM_MUTATION_META,
      success: "profile:outcomes.emailChangeRequested",
    },
  });
};

/**
 * `DELETE /user/profile` (`D12.8`; ADR-0055 §4, ADR-0028's user semantics).
 *
 * `CREDENTIAL_MUTATION` for the reason `useChangePassword` carries it: the
 * customer's current password is this mutation's `variables`, and without
 * `gcTime: 0` it outlives the dialog that collected it by five minutes.
 *
 * **It removes the profile rather than invalidating it**, which is the one
 * place this slice's standing rule — invalidate what this write could have
 * changed the response of — does not apply. Invalidation means *refetch*, and
 * the account this key holds no longer exists: the request would be answered
 * `401` by an endpoint whose session the same call revoked, which is a failed
 * query and a toast about it on the way out. Removal is the truthful move,
 * and it also means a second customer signing in on this tab cannot be shown
 * the first one's email out of a cache while their own read is in flight.
 *
 * It does **not** end the session or navigate. Both are the caller's, for
 * ADR-0049's reason rather than a stylistic one: an entity knows about a
 * resource, and "where a signed-out customer lands" is routing — the same
 * boundary `useSignOut` sits on the other side of.
 *
 * The success sentence is declared here and delivered by ADR-0034's one global
 * handler, which is what lets it be read on the login screen the caller
 * navigates to: the `<Toaster>` is mounted on the root route, above both
 * layouts, so the toast survives the navigation that follows.
 */
export const useDeleteProfile = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    ...CREDENTIAL_MUTATION,
    mutationFn: (body: DeleteProfileBody) => api.remove(body),
    meta: { ...FORM_MUTATION_META, success: "profile:outcomes.deleted" },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: profileKeys.all });
    },
  });
};

/**
 * `POST /user/profile/password/set-link` (ADR-0072 §3) — "Set a password".
 *
 * **It invalidates nothing**, `useChangeEmail`'s shape for `useChangeEmail`'s
 * reason: the account is untouched until the mailed link is followed on
 * `/reset-password`, and `hasPassword` changes then, on another screen.
 * `errorToast: false` because the control renders its own refusal beside
 * itself, and no success toast because the control swaps to the
 * check-your-mail sentence — a toast repeating it would say it twice.
 */
export const useRequestPasswordSetLink = () => {
  const api = useApi();

  return useMutation({
    mutationFn: () => api.requestPasswordSetLink(),
    meta: FORM_MUTATION_META,
  });
};

/**
 * `POST /user/profile/identities/google/start` (ADR-0072 §3) — the link
 * start. A mutation for its pending state and nothing else: the answer is a
 * URL the caller navigates to, and nothing cached changes until the callback
 * lands back on the security section, which reads the profile afresh.
 */
export const useStartGoogleLink = () => {
  const api = useApi();

  return useMutation({
    mutationFn: (body: FederatedStartBody) => api.startGoogleLink(body),
    meta: FORM_MUTATION_META,
  });
};

/**
 * `DELETE /user/profile/identities/:provider` (ADR-0072 §3) — unlink.
 *
 * `CREDENTIAL_MUTATION` for its neighbours' reason: the current password is
 * this mutation's `variables`. It invalidates the profile, whose `identities`
 * is exactly what this write changed.
 */
export const useUnlinkIdentity = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    ...CREDENTIAL_MUTATION,
    mutationFn: ({
      provider,
      body,
    }: {
      readonly provider: FederatedProvider;
      readonly body: UnlinkIdentityBody;
    }) => api.unlinkIdentity(provider, body),
    meta: {
      ...FORM_MUTATION_META,
      success: "profile:outcomes.identityUnlinked",
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: profileKeys.all });
    },
  });
};
