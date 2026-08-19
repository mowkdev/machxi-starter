import type {
  CreateStaffBody,
  ListStaffQuery,
  UpdateStaffBody,
} from "@repo/contracts";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

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

export const useCreateStaff = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateStaffBody) => api.create(body),
    meta: { success: "The staff member was created." },
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
    meta: { success: "The staff member was updated." },
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: staffKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: staffKeys.detail(id) });
    },
  });
};

export const useDeleteStaff = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.remove(id),
    meta: { success: "The staff member was deleted." },
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: staffKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: staffKeys.detail(id) });
    },
  });
};
