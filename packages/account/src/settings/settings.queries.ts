import { useApiClient } from "@repo/api-client";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { createSettingsApi } from "./settings.api";
import { settingsKeys } from "./settings.keys";
import type { AccountSettings, AccountSettingsPatch } from "./settings.types";

/**
 * The settings hooks (ADR-0043, ADR-0045 §An entity slice).
 *
 * Two things about them are deliberately unlike an ordinary entity's.
 *
 * **The query runs at boot and the settings gate waits for it.** One more
 * round trip after ADR-0033's csrf-then-refresh, paid rather than deferred,
 * and each app has its own reason to pay it. Where a grid is mounted,
 * ADR-0041's `read` is *synchronous*: a grid reads its storage once at mount,
 * so one that mounted before the mirror was seeded would show the device's
 * arrangement and never hear about the account's. Everywhere, `createI18n`
 * takes the locale at construction (ADR-0046 §4), so an account locale
 * arriving later is a language *change* rather than the answer. A settled
 * query before any of those mounts is what makes the account's values the
 * first ones, not the second.
 *
 * **A failure is not an outcome anybody is told about.** ADR-0043 makes
 * queries silent and then requires them to render their own failure panel;
 * this one has nothing to render, because a settings read that fails degrades
 * to "device only". The failure a person *does* see is a write's, through the
 * global handler.
 */

const useApi = () => createSettingsApi(useApiClient());

/**
 * `enabled` is the caller's, and the caller is the settings gate: an anonymous
 * visitor has no settings and must not be made to ask for them, because the
 * request would 401 and start a refresh for a session that does not exist.
 */
export const useSettings = ({
  enabled = true,
}: { enabled?: boolean } = {}): UseQueryResult<AccountSettings> => {
  const api = useApi();

  return useQuery({
    queryKey: settingsKeys.detail(),
    queryFn: () => api.get(),
    enabled,
    /*
     * The adopted values and the writer's mirror are the working copy and the
     * cache is their backing store; a background refetch that re-seeded them
     * would be a column snapping back under a pointer, or a theme moving under
     * somebody who has just chosen it. Refetching is what a mutation's own
     * response asks for, and nothing else.
     */
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
};

/**
 * `PATCH /settings`, as the writer flushes it and as the locale sends it.
 *
 * **No success toast** (ADR-0043 `meta`): a preference is the one kind of
 * write whose outcome is already on screen. The global failure toast stays,
 * and where the writer is what sent the body it is coalesced by construction:
 * a flaky connection costs one toast per flush.
 *
 * `setQueryData` rather than `invalidateQueries`: the response **is** the full
 * resource after the merge, so re-fetching it would be a second round trip to
 * learn what the first one already said. It also re-seeds what the gate
 * adopts, because the gate reads this cache entry.
 */
export const useUpdateSettings = (): UseMutationResult<
  AccountSettings,
  Error,
  AccountSettingsPatch
> => {
  const api = useApi();
  const queryClient = useQueryClient();

  /*
   * Whether this hook's host is still mounted (`D13.6`).
   *
   * A mutation outlives its component: `QueryClient.clear()` removes it from
   * the mutation cache and unmounting the host detaches the observer, but
   * neither stops `Mutation.execute` from calling `onSuccess`. So a `PATCH`
   * queued by one principal can resolve *after* the next one has signed in, and
   * an unconditional `setQueryData` would write the departed principal's whole
   * resource back into the entry the principal boundary has just emptied —
   * ahead of the arriving one's own `GET`, since it was sent first. The
   * settings gate would then open on it and the new principal would come up in
   * the old one's theme, locale and density.
   *
   * The latch is exactly coincident with a principal change because `D13.6`'s
   * key remounts the whole settings subtree on one, so every host of this hook
   * is torn down with it. A host that unmounts for an ordinary reason — a
   * control whose page is navigated away from — skips the write too, and that
   * costs nothing: the entry's only reader is the settings gate, which feeds
   * the adoption latches and the writer's mirror, and both already hold what
   * this request was sent to persist.
   */
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;

    return () => {
      alive.current = false;
    };
  }, []);

  return useMutation({
    mutationFn: (body: AccountSettingsPatch) => api.update(body),
    onSuccess: (settings: AccountSettings) => {
      if (!alive.current) return;

      queryClient.setQueryData(settingsKeys.detail(), settings);
    },
  });
};
