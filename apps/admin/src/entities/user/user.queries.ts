import type {
  CreateUserBody,
  ListUsersQuery,
  UpdateUserBody,
} from "@repo/contracts";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useApiClient } from "@/shared/api/context";

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
    mutationFn: (body: CreateUserBody) => api.create(body),
    meta: { success: "The user was created." },
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
    meta: { success: "The user was updated." },
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: userKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: userKeys.detail(id) });
    },
  });
};

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
