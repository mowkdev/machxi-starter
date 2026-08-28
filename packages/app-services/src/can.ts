import type { PrincipalResource, StaffRole } from "@repo/contracts";

/**
 * The role-only half of ADR-0042, with the table it reads left to the app
 * (`D9.6`, ADR-0051).
 *
 * **What moved is the predicate; what stayed is the transcription.**
 * `RESOURCE_POLICY` is read off `authorize(` calls in one API's routers and
 * names one app's resources, so it is that app's data and lives in
 * `apps/admin/src/shared/auth/policy.ts` — this file never learns that `staff`
 * or `users` exist. What is app-agnostic is the three-line rule underneath:
 * a principal that is not staff answers `false`, `super_admin` bypasses,
 * and anything else is a membership test against the table's row.
 *
 * The generics are how that split is expressed rather than described. A
 * consumer's `ResourceName` and `ResourceAction` unions flow through
 * {@link ResourcePolicy} into {@link CanFn}, so a typo at a call site is the
 * same compile error it was before the move, in an app this package has never
 * heard of.
 */

/**
 * `Partial` on purpose: **an action absent from a resource's block is allowed
 * to `super_admin` alone**, which is ADR-0019 §Rules' deny-by-default read from
 * the client side. Absence is a decision the type permits and {@link can}
 * answers, not an oversight it papers over.
 */
export type ResourcePolicy<
  TResource extends string,
  TAction extends string,
> = Readonly<
  Record<TResource, Readonly<Partial<Record<TAction, readonly StaffRole[]>>>>
>;

/**
 * May this operator's *role* perform this action on this resource? (ADR-0042)
 *
 * A pure predicate over the policy table and the principal's roles, and nothing
 * else. **The principal comes first and a hook binds it** — the same split
 * ADR-0010 makes server-side with `ctx`, and what makes this testable against a
 * fabricated principal with no React at all.
 *
 * **It answers the role-only question and refuses the other two.** ADR-0042
 * splits the API's refusals three ways: role-only (this), request-body-only
 * (`assertMaySetSuperAdmin` — a property of a field's options, named as an open
 * item and nobody's yet), and row-or-global (the rank rule, the last-super-admin
 * invariant, "nobody deletes themselves" — state no client holds). A `can()`
 * that grew a `row` parameter, or a `body` one, would be this ADR crossing the
 * line it was written to draw.
 */
export type CanFn<TAction extends string, TResource extends string> = (
  action: TAction,
  resource: TResource,
) => boolean;

export const can = <TResource extends string, TAction extends string>(
  policy: ResourcePolicy<TResource, TAction>,
  principal: PrincipalResource | null,
  action: TAction,
  resource: TResource,
): boolean => {
  /*
   * A `false` here means "not yet known", and the distinction matters.
   *
   * The predicate is total, so it must answer something for the state
   * ADR-0033's boot sequence passes through and for the one `app-sidebar`
   * documents, where the store holds an access token but no principal.
   * Conflating "no principal yet" with "denied" is safe for *rendering* — an
   * affordance that appears a tick late is a flicker — and unsafe for anything
   * irreversible, so the rule ADR-0042 leaves behind is: **no navigation,
   * redirect or one-shot decision may be taken on a `can()` evaluated before
   * the session resolved.** The shell's loading gate already holds every
   * protected screen until `bootstrapSession` settles, which is why that is a
   * rule to preserve rather than a mechanism to build.
   *
   * **The population check is what makes the predicate total, and since `D9.6`
   * it is also load-bearing.** In `apps/admin` it could not fail: that app's
   * client is pinned to `/api/v1/admin` (ADR-0033, now the `segment`
   * parameter), so the store can only ever hold a staff principal. A package
   * serves both populations, and the roles this table is keyed by are
   * `StaffRole` — a `user` principal has none, so there is nothing here to ask
   * about one and `false` is the whole answer.
   */
  if (principal === null || principal.kind !== "staff") return false;

  // ADR-0019's one line, mirrored: `super_admin` bypasses every staff role
  // check, so it bypasses this table too rather than being listed in each row.
  if (principal.roles.includes("super_admin")) return true;

  const allowed: readonly StaffRole[] = policy[resource][action] ?? [];

  return principal.roles.some((role) => allowed.includes(role));
};
