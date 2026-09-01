import type {
  StaffSettingsResource,
  UpdateStaffSettingsBody,
} from "@repo/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

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

  /*
   * Whether this hook's host is still mounted (`D13.6`).
   *
   * A mutation outlives its component: `QueryClient.clear()` removes it from
   * the mutation cache and unmounting the host detaches the observer, but
   * neither stops `Mutation.execute` from calling `onSuccess`. So a `PATCH`
   * queued by one principal can resolve *after* the next one has signed in, and
   * an unconditional `setQueryData` would write the departed operator's whole
   * resource back into the entry the principal boundary has just emptied —
   * ahead of the arriving one's own `GET`, since it was sent first. The settings
   * gate would then open on it and the new operator would come up in the old
   * one's theme, locale and density.
   *
   * The latch is exactly coincident with a principal change because `D13.6`'s
   * key remounts the whole settings subtree on one, so every host of this hook
   * is torn down with it. A host that unmounts for an ordinary reason — a
   * control whose page is navigated away from — skips the write too, and that
   * costs nothing: the entry's only reader is the settings provider, which
   * feeds the adoption latches and the writer's mirror, and both already hold
   * what this request was sent to persist.
   */
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;

    return () => {
      alive.current = false;
    };
  }, []);

  return useMutation({
    mutationFn: (body: UpdateStaffSettingsBody) => api.update(body),
    onSuccess: (settings: StaffSettingsResource) => {
      if (!alive.current) return;

      queryClient.setQueryData(settingsKeys.detail(), settings);
    },
  });
};
