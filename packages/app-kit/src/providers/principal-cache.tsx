import { useSession } from "@repo/api-client";
import type { PrincipalResource } from "@repo/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

/**
 * One principal's cached server state never becomes the next one's (`D13.6`)
 * — moved here at `D22.1` (ADR-0077 §1).
 *
 * **The rule is the cache's, not any one resource's: no server state crosses
 * a principal change.** The defect it closes was found on the settings row,
 * which is cached with `staleTime: Infinity`, so a sign-out and a sign-in **in
 * the same tab** left the previous account's resource in the cache. Evicting
 * that entry alone would have fixed the setting somebody happened to notice
 * and left every other entry to be found one at a time.
 *
 * **What an app binds is who the cache belongs to.** The two copies of this
 * file differed in what the key is made of: the staff panel keys on identity,
 * because staff are the actor of an impersonation and never its subject
 * (ADR-0057 §4); the customer app keys on identity *and* actor, because there
 * one customer id is reachable two ways. That is a function, so the function
 * is the parameter and the kit decides nothing about either population.
 *
 * **It is a render-phase eviction, and that is the whole design.** An effect
 * runs *after* the commit in which the new principal is first visible, and one
 * committed frame of the previous principal's data is the leak this exists to
 * prevent. React's own "adjust state when a value changes" pattern is what
 * runs here: the boundary re-renders itself before its children render, so
 * every `useQuery` below is building against an empty cache in the same pass.
 * TanStack Query batches its own notifications through a microtask, so nothing
 * else is updated mid-render.
 *
 * **On its own it is not enough, and the other half is the app's.**
 * `queryCache.clear()` destroys queries without notifying their observers, so
 * a mounted observer would go on rendering the previous principal's `data`
 * until some unrelated re-render. The app keys the subtree it mounts under
 * this boundary on {@link PrincipalCache.usePrincipalCacheOwner}, which
 * destroys every observer under it instead.
 *
 * **What it does not touch is `localStorage`.** The device cache in front of
 * the account is per browser, not per account (ADR-0045 §Security), and the
 * seam is identical for a cold boot and for a sign-in in this tab.
 */

/** The owner string for no session at all — a sign-out is a principal change. */
const ANONYMOUS = "anonymous";

export interface PrincipalCacheBoundaryProps {
  readonly children: ReactNode;
}

export interface PrincipalCache {
  /** Who the cache belongs to, as one comparable string. */
  readonly principalCacheOwner: (principal: PrincipalResource | null) => string;
  /** The owner of the cache as the session currently reads it. */
  readonly usePrincipalCacheOwner: () => string;
  readonly PrincipalCacheBoundary: (
    props: PrincipalCacheBoundaryProps,
  ) => ReactNode;
}

/**
 * The boundary and its two readers, bound to the app's key function.
 *
 * `ownerOf` is asked about a principal and never about the absence of one:
 * "nobody is signed in" has one answer in every app, so it is answered here.
 */
export const createPrincipalCache = (
  ownerOf: (principal: PrincipalResource) => string,
): PrincipalCache => {
  const principalCacheOwner = (principal: PrincipalResource | null): string =>
    principal === null ? ANONYMOUS : ownerOf(principal);

  const usePrincipalCacheOwner = (): string =>
    principalCacheOwner(useSession().principal);

  const PrincipalCacheBoundary = ({
    children,
  }: PrincipalCacheBoundaryProps): ReactNode => {
    const queryClient = useQueryClient();
    const owner = usePrincipalCacheOwner();
    const [cached, setCached] = useState(owner);

    if (cached !== owner) {
      /*
       * The state update is what makes this a render-phase adjustment rather
       * than a side effect in a render: React re-renders this component
       * immediately, before any child does, and the second pass finds the two
       * equal. The clear is idempotent, so repeating it is safe — React may
       * abandon a render whose `setCached` never commits, and the cost of
       * that is a refetch for the principal still on screen rather than
       * nothing. The direction that would be a leak is the one it cannot go.
       *
       * `clear()` rather than `removeQueries()`: a settled mutation's `data`
       * is the previous principal's answer too, and the mutation cache is
       * small enough that keeping it would be a carve-out with no argument
       * behind it.
       */
      setCached(owner);
      queryClient.clear();
    }

    return <>{children}</>;
  };

  return {
    principalCacheOwner,
    usePrincipalCacheOwner,
    PrincipalCacheBoundary,
  };
};
