import type { PrincipalResource } from "@repo/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { useSession } from "@/shared/api/context";

/**
 * One principal's cached server state never becomes the next one's (`D13.6`).
 *
 * **The defect this closes is older than this deliverable.** `D11.6`'s review
 * found it and recorded it rather than fixing it, and `D11.11`'s browser walk
 * carried it out of D11: nothing evicted the settings query
 * when the principal changed, and ADR-0045 §The client caches that query with
 * `staleTime: Infinity`, so a sign-out and a sign-in **in the same tab** left
 * the previous account's resource in the cache — the settings gate never held,
 * and the second operator came up in the first one's theme, language, density
 * and grid arrangements. It has been true since `D6.3` and belongs jointly to
 * every deliverable that put a key in that row, which is why those steps declined
 * to bend one setting around a cache rule governing four. D12's close routed it
 * here.
 *
 * **So the rule is the cache's, not the settings resource's: no server state
 * crosses a principal change.** The settings row is the conspicuous victim, but
 * it is not the only one — `["profile","detail"]` holds the previous account's
 * email and names on exactly the same terms, and a list a `manager` may not
 * fetch is still a list an `admin` left in the cache. Evicting the settings
 * entry alone would fix the setting somebody happened to notice and leave the
 * other entries to be found one at a time, which is the shape of change
 * `D11.11` argued against.
 *
 * **It is a render-phase eviction, and that is the whole design.** An effect
 * runs *after* the commit in which the new principal is first visible, and one
 * committed frame of the previous principal's data is the leak this exists to
 * prevent — the ADR-0045 argument for the settings gate, applied to the cache
 * behind it. React's own "adjust state when a value changes" pattern is what
 * runs here: the boundary re-renders itself before its children render, so
 * every `useQuery` below is building against an empty cache in the same pass.
 * TanStack Query batches its own notifications through a microtask, so nothing
 * else is updated mid-render.
 *
 * **What it does not touch is `localStorage`.** The theme, the locale and the
 * grid arrangements have a device cache in front of the account (ADR-0045 §The
 * server adapter), and ADR-0045 §Security decided what that means for a shared
 * machine: the cache is per browser, not per account, and its one cross-account
 * seam — a second account adopting the first's *local-only* grid entries on its
 * first sync — was recorded rather than engineered around. That record is
 * frozen (D6 shipped), and the seam is identical for a cold boot and for a
 * sign-in in this tab, so it is left exactly as it was rather than closed here
 * on this step's authority.
 */

/** The owner string for no session at all — a sign-out is a principal change. */
const ANONYMOUS = "anonymous";

/**
 * Who the cache belongs to, as one comparable string.
 *
 * **Identity is the whole of the answer in this app, and that is a decision
 * rather than an omission.** ADR-0057 §4 leaves `StaffPrincipalResource`
 * deliberately unchanged — the mint is `POST /admin/users/:id/impersonate`, so
 * staff are the actor and never the subject, and no staff principal can carry
 * an `impersonatedBy`. The customer app's twin of this function adds the actor,
 * because there one customer id is reachable two ways.
 */
export const principalCacheOwner = (
  principal: PrincipalResource | null,
): string =>
  principal === null ? ANONYMOUS : `${principal.kind}:${principal.id}`;

/** The owner of the cache as the session currently reads it. */
export const usePrincipalCacheOwner = (): string =>
  principalCacheOwner(useSession().principal);

export interface PrincipalCacheBoundaryProps {
  readonly children: ReactNode;
}

export const PrincipalCacheBoundary = ({
  children,
}: PrincipalCacheBoundaryProps) => {
  const queryClient = useQueryClient();
  const owner = usePrincipalCacheOwner();
  const [cached, setCached] = useState(owner);

  if (cached !== owner) {
    /*
     * The state update is what makes this a render-phase adjustment rather than
     * a side effect in a render: React re-renders this component immediately,
     * before any child does, and the second pass finds the two equal. The clear
     * is idempotent, so repeating it is safe — React may abandon a render whose
     * `setCached` never commits, and the cost of that is a refetch for the
     * principal still on screen rather than nothing. The direction that would
     * be a leak is the one it cannot go.
     *
     * `clear()` rather than `removeQueries()`: a settled mutation's `data` is
     * the previous principal's answer too, and the mutation cache is small
     * enough that keeping it would be a carve-out with no argument behind it.
     */
    setCached(owner);
    queryClient.clear();
  }

  return <>{children}</>;
};
