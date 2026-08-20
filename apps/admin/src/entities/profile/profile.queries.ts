import type {
  ChangePasswordBody,
  StaffPrincipalResource,
  StaffResource,
  UpdateStaffProfileBody,
} from "@repo/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useApiClient, useSetPrincipal } from "@/shared/api/context";

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
 * What they cannot invalidate is the **staff list**, where the acting admin is
 * also a row. ADR-0032 allows an entity to import from `shared` and nowhere
 * else, so `entities/profile` cannot reach `staffKeys` — deliberately, because
 * the alternative is a graph of entities invalidating each other. The cost is
 * bounded and worth stating: rename yourself, then open `/staff`, and the row
 * may show the old name until that query goes stale. Fixing it properly is a
 * cross-entity invalidation vocabulary, which is a decision rather than a line
 * of code and does not belong in this step.
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
 * `gcTime: 0` for the reason the two staff credential mutations carry it
 * (ADR-0034, amended D3.7): TanStack Query keeps a settled mutation's
 * `variables` for the default five minutes, so without this the operator's old
 * *and* new passwords outlive the dialog that collected them, the `reset()`
 * that cleared it and the unmount that removed it — reachable from
 * `getMutationCache()`. Nothing reads them; the point is that nothing can.
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
    gcTime: 0,
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
