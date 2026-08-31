import type {
  ChangePasswordBody,
  UpdateProfileBody,
  UserPrincipalResource,
  UserResource,
} from "@repo/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useApiClient, useSetPrincipal } from "@/shared/api/context";
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
 * the store, so a stale field cannot survive the update: everything the wire
 * principal carries is on the resource, and `kind` is `"user"` because this app
 * talks to the `/user` segment and nothing else can answer here (ADR-0015).
 */
const toPrincipal = (user: UserResource): UserPrincipalResource => ({
  kind: "user",
  id: user.id,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  roles: user.roles,
});

export const useUpdateProfile = () => {
  const api = useApi();
  const queryClient = useQueryClient();
  const setPrincipal = useSetPrincipal();

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
      setPrincipal(toPrincipal(profile));
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
