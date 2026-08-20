import type {
  ChangePasswordBody,
  StaffPrincipalResource,
  StaffResource,
  UpdateStaffProfileBody,
} from "@repo/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useApiClient, useSetPrincipal } from "@/shared/api/context";
import { CREDENTIAL_MUTATION } from "@/shared/api/credential-mutation";

import { createProfileApi } from "./profile.api";
import { profileKeys } from "./profile.keys";

/**
 * The profile hooks (ADR-0034).
 *
 * The same invalidation rule as every other entity — invalidate what this write
 * could have changed the response of — reduced to its smallest case: there is
 * one cache entry, so both mutations invalidate `profileKeys.all` and there is
 * nothing else of this entity's to name.
 *
 * What they do **not** invalidate is the staff entity, where the acting
 * operator is also a row — not because the staleness is acceptable but because
 * this is the wrong layer to fix it from: ADR-0032 lets an entity import from
 * `shared` and nowhere else, so `entities/profile` cannot reach `staffKeys`.
 * The layer that may see both is the feature, and it does:
 * `features/profile-manage/use-invalidate-own-staff-row.ts`.
 */

const useApi = () => createProfileApi(useApiClient());

export const useProfile = () => {
  const api = useApi();

  return useQuery({
    queryKey: profileKeys.detail(),
    queryFn: () => api.get(),
  });
};

/** `errorToast: false`: both of these are submitted from a form that renders
 * its failures inline (ADR-0034, and see `staff.queries.ts` for the argument). */
const FORM_MUTATION_META = { errorToast: false } as const;

/**
 * The staff member as the session's principal.
 *
 * Rebuilt from the response rather than spread over the principal already in
 * the store, so a stale field cannot survive the update: everything the wire
 * principal carries is on the resource, and `kind` is `"staff"` because this
 * app talks to the admin segment and nothing else can answer here (ADR-0015).
 */
const toPrincipal = (staff: StaffResource): StaffPrincipalResource => ({
  kind: "staff",
  id: staff.id,
  email: staff.email,
  firstName: staff.firstName,
  lastName: staff.lastName,
  roles: staff.roles,
});

export const useUpdateProfile = () => {
  const api = useApi();
  const queryClient = useQueryClient();
  const setPrincipal = useSetPrincipal();

  return useMutation({
    mutationFn: (body: UpdateStaffProfileBody) => api.update(body),
    meta: { ...FORM_MUTATION_META, success: "Your profile was updated." },
    onSuccess: (profile) => {
      void queryClient.invalidateQueries({ queryKey: profileKeys.all });
      // The account whose name is in the sidebar footer is this one, and it
      // just changed. See `useSetPrincipal` for why the store is written here
      // rather than the shell being made to fetch.
      setPrincipal(toPrincipal(profile));
    },
  });
};

/**
 * `POST /admin/profile/change-password` (ADR-0027 §Staff self-service).
 *
 * `CREDENTIAL_MUTATION` for the reason the staff ones carry it (ADR-0034,
 * amended D3.7): the operator's old *and* new passwords are this mutation's
 * `variables`, and without `gcTime: 0` they outlive the dialog that collected
 * them by five minutes.
 *
 * It invalidates the profile because the password write stamps `updatedAt` on
 * the row, which is the same test every other mutation here answers: does the
 * response of a cached query change because of this write?
 *
 * It does **not** touch the session. ADR-0027 spares the caller's session
 * precisely because the caller proved ownership by presenting the current
 * password, so the access token in memory stays valid and this screen stays
 * signed in — while every other device is signed out at its next request. The
 * absence of a `client.endSession()` here is the decision, not an oversight.
 */
export const useChangePassword = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    ...CREDENTIAL_MUTATION,
    mutationFn: (body: ChangePasswordBody) => api.changePassword(body),
    meta: {
      ...FORM_MUTATION_META,
      success:
        "Your password was changed. Every other session was signed out; this one stays.",
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: profileKeys.all });
    },
  });
};
