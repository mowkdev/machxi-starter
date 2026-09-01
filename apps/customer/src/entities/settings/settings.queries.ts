import type {
  UpdateUserSettingsBody,
  UserSettingsResource,
} from "@repo/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { useApiClient } from "@/shared/api/context";

import { createSettingsApi } from "./settings.api";
import { settingsKeys } from "./settings.keys";

/**
 * The settings hooks (ADR-0043, ADR-0045 §An entity slice).
 *
 * Two things about them are deliberately unlike this app's other entity.
 *
 * **The query runs at boot and the settings gate waits for it.** One more round
 * trip after ADR-0033's csrf-then-refresh, paid rather than deferred — and the
 * two things that make it worth paying are *this* app's rather than the
 * admin's, because this app has no grid whose synchronous `read` forced it
 * there. They are the locale and the density: `createI18n` takes the locale at
 * construction (ADR-0046 §4), so an account locale arriving later is a language
 * *change* rather than the answer; and `GridDensityProvider` seeds from
 * `adopted` on the render it mounts. A settled query before either provider
 * mounts is what makes the account's values the first ones, not the second.
 *
 * **A failure is not an outcome anybody is told about.** ADR-0043 makes queries
 * silent and then requires them to render their own failure panel; this one has
 * nothing to render, because a settings read that fails degrades to "device
 * only" — the device locale and the device theme, which is exactly the app a
 * customer has before they sign in. The failure they *do* see is a write's,
 * through the global handler.
 */

const useApi = () => createSettingsApi(useApiClient());

/**
 * `enabled` is the caller's, and the caller is the settings gate: an anonymous
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
     * The adopted values are the working copy and the cache is its backing
     * store; a background refetch that re-seeded them would move a theme under
     * somebody who has just chosen it. Refetching is what a mutation's own
     * response asks for, and nothing else.
     */
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
};

/**
 * `PATCH /user/settings`, as the writer flushes it and as the locale sends it.
 *
 * **No success toast** (ADR-0043 `meta`): a chosen theme is confirmed by the
 * app changing colour, and a chosen language by the words changing — a
 * preference is the one kind of write whose outcome is already on screen. The
 * global failure toast stays, and where the writer is what sent the body it is
 * coalesced by construction: a flaky connection costs one toast per flush.
 *
 * `setQueryData` rather than `invalidateQueries`: the response **is** the full
 * resource after the merge, so re-fetching it would be a second round trip to
 * learn what the first one already said. It also re-seeds what the three
 * providers adopt, because the gate reads them off this cache entry.
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
   * an unconditional `setQueryData` would write the departed customer's whole
   * resource back into the entry the principal boundary has just emptied —
   * ahead of the arriving one's own `GET`, since it was sent first. The settings
   * gate would then open on it and the new customer would come up in the old
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
    mutationFn: (body: UpdateUserSettingsBody) => api.update(body),
    onSuccess: (settings: UserSettingsResource) => {
      if (!alive.current) return;

      queryClient.setQueryData(settingsKeys.detail(), settings);
    },
  });
};
