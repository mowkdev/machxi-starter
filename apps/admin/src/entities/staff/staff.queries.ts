import type {
  CreateStaffBody,
  ListStaffQuery,
  ResendStaffOnboardingBody,
  SetEmailBody,
  SetPasswordBody,
  UpdateStaffBody,
} from "@repo/contracts";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { CREDENTIAL_MUTATION } from "@/shared/api/credential-mutation";
import { useApiClient } from "@/shared/api/context";

import { createStaffApi } from "./staff.api";
import { staffKeys } from "./staff.keys";

/**
 * The staff hooks (ADR-0034).
 *
 * Every mutation follows the same invalidation rule, and there is nothing
 * clever about it — which is the point: invalidate the entity's `lists()`
 * prefix and the touched `detail(id)`. A rule with no exceptions is one nobody
 * has to remember per call site.
 *
 * `meta.success` is how a mutation states its outcome; the global mutation
 * cache delivers it. Nothing here calls `toast()`, which is the anti-pattern
 * ADR-0034 replaces.
 */

const useApi = () => createStaffApi(useApiClient());

export const useStaffList = (params: ListStaffQuery) => {
  const api = useApi();

  return useQuery({
    queryKey: staffKeys.list(params),
    queryFn: () => api.list(params),
    // Paging does not flash an empty table: the previous page stays put until
    // the next one arrives.
    placeholderData: keepPreviousData,
  });
};

export const useStaff = (id: string) => {
  const api = useApi();

  return useQuery({
    queryKey: staffKeys.detail(id),
    queryFn: () => api.get(id),
  });
};

/**
 * `errorToast: false` on the three mutations a **form** hosts.
 *
 * ADR-0034 splits the two halves cleanly: field-level failures belong to the
 * form, operation-level outcomes belong to toasts. Each of these is submitted
 * from a form that calls `applyServerErrors`, which lands what it can next to a
 * field and everything else at the top of the form — so leaving the toast on
 * would say the same thing twice, once where the operator is already looking
 * and once over the top of it. The confirms below keep theirs, because a
 * confirm has no field for a refusal to land on.
 */
const FORM_MUTATION_META = { errorToast: false } as const;

export const useCreateStaff = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    // The body carries the new operator's initial password.
    ...CREDENTIAL_MUTATION,
    mutationFn: (body: CreateStaffBody) => api.create(body),
    meta: { ...FORM_MUTATION_META, success: "staff:outcomes.created" },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: staffKeys.lists() });
    },
  });
};

export const useUpdateStaff = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateStaffBody }) =>
      api.update(id, body),
    meta: { ...FORM_MUTATION_META, success: "staff:outcomes.updated" },
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: staffKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: staffKeys.detail(id) });
    },
  });
};

/**
 * The administrative password reset (ADR-0027).
 *
 * It invalidates like any other write, and the reason is not ceremony: the
 * password write sets `updatedAt` on the row, so a list or a detail left in
 * cache would show a stale one. The rule stays exception-free.
 */
export const useSetStaffPassword = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    // Two plaintext passwords in the variables, one of them the actor's own.
    ...CREDENTIAL_MUTATION,
    mutationFn: ({ id, body }: { id: string; body: SetPasswordBody }) =>
      api.setPassword(id, body),
    meta: {
      ...FORM_MUTATION_META,
      success: "staff:outcomes.passwordReset",
    },
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: staffKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: staffKeys.detail(id) });
    },
  });
};

/**
 * The administrative address change (`D18.10`, ADR-0071 §7).
 *
 * `CREDENTIAL_MUTATION` for the variables, as the reset above: the body
 * carries the acting operator's plaintext password. It invalidates the
 * ordinary way — the address is a column both the list and the detail render.
 */
export const useSetStaffEmail = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    ...CREDENTIAL_MUTATION,
    mutationFn: ({ id, body }: { id: string; body: SetEmailBody }) =>
      api.setEmail(id, body),
    meta: {
      ...FORM_MUTATION_META,
      success: "staff:outcomes.emailChanged",
    },
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: staffKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: staffKeys.detail(id) });
    },
  });
};

/**
 * A fresh invitation link (`D18.11`, ADR-0071 §8).
 *
 * The second mutation here that invalidates **nothing**, and for
 * `useRevokeStaffSessions`'s reason: it writes a token row and sends a
 * message, and neither is a column of the staff resource. The row's
 * `updatedAt` does not move, so a refetch could only ever return what is
 * already on screen.
 *
 * It keeps its error toast — the confirm that hosts it has no field for a
 * refusal to land on, which is where `STAFF_NOT_INVITED` goes when the row
 * stopped being `invited` while the menu was open.
 */
export const useResendStaffOnboarding = () => {
  const api = useApi();

  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: ResendStaffOnboardingBody;
    }) => api.resendOnboarding(id, body),
    meta: { success: "staff:outcomes.invitationSent" },
  });
};

/**
 * Forced sign-out (ADR-0018 §Revocation).
 *
 * The first mutation here that invalidates **nothing**, and that is the rule
 * holding rather than bending: it writes to `sessions`, which is a different
 * aggregate and one this app does not cache. Nothing on the staff resource
 * changes, so there is no key of this entity's to invalidate — an
 * `invalidateQueries` here would be a refetch that can only ever return what is
 * already on screen.
 */
export const useRevokeStaffSessions = () => {
  const api = useApi();

  return useMutation({
    mutationFn: (id: string) => api.revokeSessions(id),
    meta: { success: "staff:outcomes.sessionsRevoked" },
  });
};

export const useDeleteStaff = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.remove(id),
    meta: { success: "staff:outcomes.deleted" },
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: staffKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: staffKeys.detail(id) });
    },
  });
};
