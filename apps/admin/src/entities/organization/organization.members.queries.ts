import type {
  AddMembershipBody,
  ListMembershipsQuery,
  OrganizationRole,
} from "@repo/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useApiClient } from "@/shared/api/context";

import { createOrganizationMembersApi } from "./organization.members.api";
import { organizationsKeys } from "./organization.keys";

/**
 * The memberships hooks (ADR-0034, ADR-0067 §3).
 *
 * Every mutation invalidates `members(organizationId)` and nothing else. That
 * is the whole rule, and the *absence* is the part worth reading: a membership
 * write does not touch the organization's `detail` or the resource's `lists()`,
 * because no field of either changes when somebody joins or leaves — the row
 * carries a name, a slug and a kind, none of which a membership can move.
 * Invalidating them would be a refetch of two screens to show the same bytes
 * (ADR-0043 §Invalidation).
 *
 * **The other direction is not symmetric**, and that is the key hierarchy
 * rather than a decision: `memberLists(id)` sits *under* `detail(id)`, so the
 * organization's own `PATCH` — which invalidates `detail(id)` — refetches this
 * table too. Harmless (a rename is one request either way) and worth knowing
 * before somebody reads "nothing else" as a claim about both directions.
 *
 * All three carry `meta.success`, and none of them carries `errorToast: false`:
 * these are not form submissions with a field to land an error next to — the
 * add dialog's one field is a uuid the API answers `404` for, which has no zod
 * issue and no box of its own, so a toast is where it belongs.
 */

const useApi = () => createOrganizationMembersApi(useApiClient());

/**
 * The page the section renders. Small by nature — one organization's people.
 *
 * **`errorToast: true`, which almost nothing else in this app sets** (ADR-0034:
 * queries are silent and render their own failure panel). The grid next door
 * threads its `error` into `AppGrid`, which draws one; this section is a plain
 * table with an empty row, and an empty row is what a *failed* fetch would
 * otherwise render — telling an operator with authority that a tenant has
 * nobody in it. The section branches on `isError` for the row, and this makes
 * the failure audible as well as visible (`D15.4`'s review).
 */
export const useOrganizationMembers = (
  organizationId: string,
  params: ListMembershipsQuery,
) => {
  const api = useApi();

  return useQuery({
    queryKey: organizationsKeys.members(organizationId, params),
    queryFn: () => api.list(organizationId, params),
    meta: { errorToast: true },
  });
};

export const useAddOrganizationMember = (organizationId: string) => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: AddMembershipBody) => api.add(organizationId, body),
    meta: { success: "organizations:members.outcomes.added" },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: organizationsKeys.memberLists(organizationId),
      });
    },
  });
};

export const useSetOrganizationMemberRole = (organizationId: string) => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      userId,
      role,
    }: {
      readonly userId: string;
      readonly role: OrganizationRole;
    }) => api.setRole(organizationId, userId, role),
    meta: { success: "organizations:members.outcomes.roleChanged" },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: organizationsKeys.memberLists(organizationId),
      });
    },
  });
};

export const useRemoveOrganizationMember = (organizationId: string) => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => api.remove(organizationId, userId),
    meta: { success: "organizations:members.outcomes.removed" },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: organizationsKeys.memberLists(organizationId),
      });
    },
  });
};
