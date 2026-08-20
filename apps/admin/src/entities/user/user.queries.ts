import type {
  CreateUserBody,
  ListUsersQuery,
  SetPasswordBody,
  UpdateUserBody,
} from "@repo/contracts";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useApiClient } from "@/shared/api/context";
import { CREDENTIAL_MUTATION } from "@/shared/api/credential-mutation";

import { createUserApi } from "./user.api";
import { userKeys } from "./user.keys";

/**
 * The user hooks (ADR-0034).
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

const useApi = () => createUserApi(useApiClient());

/**
 * `errorToast: false` on the mutations a **form** hosts, because each of them
 * calls `applyServerErrors` and the failure is already on screen next to the
 * field it belongs to, or at the top of the form. The confirms keep their
 * toast: a confirm has no field for a refusal to land on (ADR-0034).
 */
const FORM_MUTATION_META = { errorToast: false } as const;

export const useUserList = (params: ListUsersQuery) => {
  const api = useApi();

  return useQuery({
    queryKey: userKeys.list(params),
    queryFn: () => api.list(params),
    // Paging does not flash an empty table: the previous page stays put until
    // the next one arrives.
    placeholderData: keepPreviousData,
  });
};

export const useUser = (id: string) => {
  const api = useApi();

  return useQuery({
    queryKey: userKeys.detail(id),
    queryFn: () => api.get(id),
  });
};

export const useCreateUser = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    // The body carries the new account's initial password.
    ...CREDENTIAL_MUTATION,
    mutationFn: (body: CreateUserBody) => api.create(body),
    meta: { ...FORM_MUTATION_META, success: "The user was created." },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
};

export const useUpdateUser = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateUserBody }) =>
      api.update(id, body),
    meta: { ...FORM_MUTATION_META, success: "The user was updated." },
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: userKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: userKeys.detail(id) });
    },
  });
};

/**
 * The administrative password reset (ADR-0027).
 *
 * Invalidates like any other write because the password write sets `updatedAt`
 * on the row, so a cached list or detail would show a stale one.
 */
export const useSetUserPassword = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    // Two plaintext passwords in the variables, one of them the actor's own.
    ...CREDENTIAL_MUTATION,
    mutationFn: ({ id, body }: { id: string; body: SetPasswordBody }) =>
      api.setPassword(id, body),
    meta: {
      ...FORM_MUTATION_META,
      success:
        "The password was reset and every session of that account was signed out.",
    },
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: userKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: userKeys.detail(id) });
    },
  });
};

/**
 * Forced sign-out, and the one mutation here that invalidates **nothing**.
 *
 * It writes `sessions`, a different aggregate that this app does not cache, and
 * the `users` row is untouched — so there is no key of this entity's to
 * invalidate (ADR-0034, amended D3.7).
 */
export const useRevokeUserSessions = () => {
  const api = useApi();

  return useMutation({
    mutationFn: (id: string) => api.revokeSessions(id),
    meta: { success: "Every session of that account was signed out." },
  });
};

/**
 * The **soft** delete (ADR-0028), which is why the list is invalidated rather
 * than the row being dropped from the cache: the account stays listed, with
 * `deletedAt` set and `status` written to `disabled`, and the grid has to show
 * the new shape rather than a gap where a row used to be.
 */
export const useDeleteUser = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.remove(id),
    meta: { success: "The user was deleted." },
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: userKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: userKeys.detail(id) });
    },
  });
};
