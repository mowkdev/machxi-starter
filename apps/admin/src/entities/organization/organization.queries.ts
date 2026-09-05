import type {
  CreateOrganizationAdminBody,
  ListOrganizationsQuery,
  UpdateOrganizationBody,
} from "@repo/contracts";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useApiClient } from "@/shared/api/context";

import { createOrganizationsApi } from "./organization.api";
import { organizationsKeys } from "./organization.keys";

/**
 * The organizations hooks (ADR-0034).
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

const useApi = () => createOrganizationsApi(useApiClient());

export const useOrganizationsList = (params: ListOrganizationsQuery) => {
  const api = useApi();

  return useQuery({
    queryKey: organizationsKeys.list(params),
    queryFn: () => api.list(params),
    // Paging does not flash an empty table: the previous page stays put until
    // the next one arrives.
    placeholderData: keepPreviousData,
  });
};

export const useOrganization = (id: string) => {
  const api = useApi();

  return useQuery({
    queryKey: organizationsKeys.detail(id),
    queryFn: () => api.get(id),
  });
};

/**
 * `errorToast: false` on the two mutations a **form** hosts.
 *
 * ADR-0034 splits the two halves cleanly: field-level failures belong to the
 * form, operation-level outcomes belong to toasts. Each of these is submitted
 * from a form that calls `applyServerErrors`, which lands what it can next to a
 * field and everything else at the top of the form — so leaving the toast on
 * would say the same thing twice, once where the operator is already looking
 * and once over the top of it. The confirm below keeps its toast, because a
 * confirm has no field for a refusal to land on.
 */
const FORM_MUTATION_META = { errorToast: false } as const;

export const useCreateOrganization = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateOrganizationAdminBody) => api.create(body),
    meta: { ...FORM_MUTATION_META, success: "organizations:outcomes.created" },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: organizationsKeys.lists(),
      });
    },
  });
};

export const useUpdateOrganization = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateOrganizationBody }) =>
      api.update(id, body),
    meta: { ...FORM_MUTATION_META, success: "organizations:outcomes.updated" },
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({
        queryKey: organizationsKeys.lists(),
      });
      void queryClient.invalidateQueries({
        queryKey: organizationsKeys.detail(id),
      });
    },
  });
};

export const useDeleteOrganization = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.remove(id),
    meta: { success: "organizations:outcomes.deleted" },
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({
        queryKey: organizationsKeys.lists(),
      });
      void queryClient.invalidateQueries({
        queryKey: organizationsKeys.detail(id),
      });
    },
  });
};
