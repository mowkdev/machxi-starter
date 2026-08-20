import type { PrincipalResource } from "@repo/contracts";

import {
  RESOURCE_POLICY,
  type ResourceAction,
  type ResourceName,
  type ResourcePolicy,
} from "./policy";

/*
 * Widened once, here, rather than at the lookup.
 *
 * `RESOURCE_POLICY` is `as const satisfies ResourcePolicy`, which is what lets
 * the fixture test compare exact values — and it also makes each row's type the
 * literal tuple it happens to hold, so `["admin"].includes(role)` is a compile
 * error for a `role` that could be `"editor"`. Reading through the declared
 * type asks the question the predicate is actually asking.
 */
const POLICY: ResourcePolicy = RESOURCE_POLICY;

/**
 * May this operator's *role* perform this action on this resource? (ADR-0042)
 *
 * A pure predicate over {@link RESOURCE_POLICY} and the principal's roles, and
 * nothing else. **The principal comes first and a hook binds it** — the same
 * split ADR-0010 makes server-side with `ctx`, and what makes this testable
 * against a fabricated principal with no React at all.
 *
 * **It answers the role-only question and refuses the other two.** ADR-0042
 * splits the API's refusals three ways: role-only (this), request-body-only
 * (`assertMaySetSuperAdmin` — a property of a field's options, named as an open
 * item and nobody's yet), and row-or-global (the rank rule, the last-super-admin
 * invariant, "nobody deletes themselves" — state this app does not hold). A
 * `can()` that grew a `row` parameter, or a `body` one, would be this ADR
 * crossing the line it was written to draw.
 */
export type CanFn = (action: ResourceAction, resource: ResourceName) => boolean;

export const can = (
  principal: PrincipalResource | null,
  action: ResourceAction,
  resource: ResourceName,
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
   * The population check makes the predicate total rather than guarding
   * anything: `apps/admin`'s client is pinned to `/api/v1/admin` (ADR-0033), so
   * the store can only ever hold a staff principal.
   */
  if (principal === null || principal.kind !== "staff") return false;

  // ADR-0019's one line, mirrored: `super_admin` bypasses every staff role
  // check, so it bypasses this table too rather than being listed in each row.
  if (principal.roles.includes("super_admin")) return true;

  const allowed = POLICY[resource][action] ?? [];

  return principal.roles.some((role) => allowed.includes(role));
};
