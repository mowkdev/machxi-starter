import type { PrincipalResource } from "@repo/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { useSession } from "@/shared/api/context";

/**
 * One principal's cached server state never becomes the next one's (`D13.6`).
 *
 * **The defect this closes is older than this app.** `D11.6`'s review found it
 * in the admin panel and recorded it rather than fixing it, and `D11.11`'s
 * browser walk carried it out of D11: nothing evicted the
 * settings query when the principal changed, and ADR-0045 §The client (as
 * carried by ADR-0053) caches that query with `staleTime: Infinity`, so a
 * sign-out and a sign-in **in the same tab** left the previous account's
 * resource in the cache — the settings gate never held, and the second customer
 * came up in the first one's theme, language and density. This app inherited
 * the seam whole at `D12.7`; D12's close routed the fix here, and it is built
 * in both apps in one step because it is one property.
 *
 * **So the rule is the cache's, not the settings resource's: no server state
 * crosses a principal change.** The settings row is the conspicuous victim, but
 * `["profile","detail"]` holds the previous customer's email and names on
 * exactly the same terms — `useDeleteProfile` already removes it by hand for
 * that reason, which is one path of many closed one at a time. Evicting the
 * settings entry alone would fix the setting somebody happened to notice.
 *
 * **It is a render-phase eviction, and that is the whole design.** An effect
 * runs *after* the commit in which the new principal is first visible, and one
 * committed frame of the previous principal's data is the leak this exists to
 * prevent. React's own "adjust state when a value changes" pattern is what runs
 * here: the boundary re-renders itself before its children render, so every
 * `useQuery` below is building against an empty cache in the same pass.
 * TanStack Query batches its own notifications through a microtask, so nothing
 * else is updated mid-render.
 *
 * **On its own it would not be enough, and the other half is in `settings.tsx`.**
 * `queryCache.clear()` destroys queries without notifying their observers, so a
 * mounted `useSettings` would go on rendering the previous principal's `data`
 * until some unrelated re-render. The `key` on the settings subtree destroys
 * every observer under it instead, which is why the two are mounted together
 * and neither is optional.
 *
 * **What it does not touch is `localStorage`.** The theme and the locale have a
 * device cache in front of the account (ADR-0045 §The server adapter, ADR-0046
 * §4), and ADR-0045 §Security decided what that means for a shared machine: the
 * cache is per browser, not per account, and its cross-account seam was
 * recorded rather than engineered around. That record is frozen (D6 shipped),
 * and the seam is identical for a cold boot and for a sign-in in this tab, so
 * it is left exactly as it was rather than closed here on this step's
 * authority.
 */

/** The owner string for no session at all — a sign-out is a principal change. */
const ANONYMOUS = "anonymous";

/**
 * Who the cache belongs to, as one comparable string.
 *
 * **Identity *and* actor, which is this app's difference from the admin's twin
 * and a decision `D13.6` had to take rather than inherit.** Since `D13.5` a
 * customer id is reachable two ways: by the customer, and through an
 * impersonated session carrying the operator in `impersonatedBy` (ADR-0057 §4).
 * The subject of `GET /settings` is `ctx.principal` either way, so the two
 * sessions read *the same row* and keying on identity alone would be sufficient
 * today — by coincidence rather than by construction.
 *
 * It is keyed on both because the coincidence is not a property this seam
 * should have to re-derive. The boundary evicts every cached resource, not the
 * settings row, and "which of them happen to have the same subject under both
 * sessions" is a question each new key would reopen — silently, since the
 * failure mode is adoption rather than an error. A change of actor is a change
 * of session, the cost of treating it as one is a refetch nobody waits on, and
 * the alternative fails open.
 */
export const principalCacheOwner = (
  principal: PrincipalResource | null,
): string => {
  if (principal === null) return ANONYMOUS;

  const actor =
    principal.kind === "user" ? principal.impersonatedBy : undefined;

  /*
   * `== null` rather than `=== undefined`: the wire principal is passed through
   * unvalidated by `@repo/api-client`, and an `impersonatedBy: null` would
   * throw here — in the render phase of a provider mounted above every error
   * boundary, which is a blank app rather than a caught failure.
   */
  return actor == null
    ? `${principal.kind}:${principal.id}`
    : `${principal.kind}:${principal.id}#actor:${actor.id}`;
};

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
