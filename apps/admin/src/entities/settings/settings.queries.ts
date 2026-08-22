import type {
  StaffSettingsResource,
  UpdateStaffSettingsBody,
} from "@repo/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useApiClient } from "@/shared/api/context";

import { createSettingsApi } from "./settings.api";
import { settingsKeys } from "./settings.keys";

/**
 * The settings hooks (ADR-0043, ADR-0045 §An entity slice).
 *
 * Two things about them are deliberately unlike every other entity here.
 *
 * **The query runs at session bootstrap and the boot gate waits for it.** One
 * more round trip after ADR-0033's csrf-then-refresh, paid rather than
 * deferred because ADR-0041's `read` is *synchronous*: a grid reads its storage
 * once at mount, so a grid that mounted before the mirror was seeded would show
 * the local cache and never hear about the account's answer. A settled query —
 * success or failure — before any dashboard route renders is what makes the
 * first-sync rule run exactly once.
 *
 * **A failure is not an outcome anybody is told about.** ADR-0043 makes queries
 * silent and then requires them to render their own failure panel; this one has
 * nothing to render, because a settings read that fails degrades to "local
 * only" — which is precisely the app the operator had before this deliverable.
 * The failure the operator *does* see is a write's, through the global handler.
 */

const useApi = () => createSettingsApi(useApiClient());

/**
 * `enabled` is the caller's, and the caller is the boot gate: an anonymous
 * visitor has no settings and must not be made to ask for them, because the
 * request would 401 and start a refresh for a session that does not exist.
 */
export const useSettings = ({ enabled = true }: { enabled?: boolean } = {}) => {
  const api = useApi();

  return useQuery({
    queryKey: settingsKeys.detail(),
    queryFn: () => api.get(),
    enabled,
    /*
     * The mirror is the working copy and the cache is its backing store; a
     * background refetch that re-seeds it mid-drag would be a column snapping
     * back under the operator's pointer. Refetching is what a mutation's
     * invalidation asks for, and nothing else.
     */
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
};

/**
 * `PATCH /admin/settings`, as the writer flushes it.
 *
 * **No success toast** (ADR-0043 `meta`): a resized column is not an outcome an
 * operator needs told, and a per-pixel confirmation would be noise on the one
 * surface this deliverable exists to keep quiet. The global failure toast
 * stays, and it is coalesced by construction — a flaky connection costs one
 * toast per flush, not one per write.
 *
 * `setQueryData` rather than `invalidateQueries`: the response **is** the full
 * resource after the merge, so re-fetching it would be a second round trip to
 * learn what the first one already said. It also re-seeds the mirror, because
 * the provider syncs the writer from this cache entry.
 */
export const useUpdateSettings = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: UpdateStaffSettingsBody) => api.update(body),
    onSuccess: (settings: StaffSettingsResource) => {
      queryClient.setQueryData(settingsKeys.detail(), settings);
    },
  });
};
