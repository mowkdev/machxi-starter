import { createPrincipalCache } from "@/shared/api/principal-cache";

/**
 * The principal-cache boundary, bound to this app's key (`D13.6`; the
 * boundary itself is `@repo/app-kit`'s since `D22.1`, ADR-0077 §1).
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
 *
 * The other half of the eviction is in `./settings`: the `key` on the
 * settings subtree, which is why the two are mounted together.
 */
export const {
  PrincipalCacheBoundary,
  principalCacheOwner,
  usePrincipalCacheOwner,
} = createPrincipalCache((principal) => {
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
});

export type { PrincipalCacheBoundaryProps } from "@/shared/api/principal-cache";
