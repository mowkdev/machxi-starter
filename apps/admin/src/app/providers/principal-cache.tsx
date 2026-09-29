import { createPrincipalCache } from "@/shared/api/principal-cache";

/**
 * The principal-cache boundary, bound to this app's key (`D13.6`; the
 * boundary itself is `@repo/app-kit`'s since `D22.1`, ADR-0077 §1).
 *
 * **Identity is the whole of the answer in this app, and that is a decision
 * rather than an omission.** ADR-0057 §4 leaves `StaffPrincipalResource`
 * deliberately unchanged — the mint is `POST /admin/users/:id/impersonate`, so
 * staff are the actor and never the subject, and no staff principal can carry
 * an `impersonatedBy`. The customer app's twin of this function adds the
 * actor, because there one customer id is reachable two ways.
 *
 * The other half of the eviction is in `./settings`: the `key` on the
 * settings subtree, which is why the two are mounted together.
 */
export const {
  PrincipalCacheBoundary,
  principalCacheOwner,
  usePrincipalCacheOwner,
} = createPrincipalCache((principal) => `${principal.kind}:${principal.id}`);

export type { PrincipalCacheBoundaryProps } from "@/shared/api/principal-cache";
