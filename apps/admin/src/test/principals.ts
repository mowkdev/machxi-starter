import type { StaffPrincipalResource, StaffRole } from "@repo/contracts";

import {
  createSessionStore,
  type SessionStore,
} from "@/shared/api/session-store";

/**
 * A signed-in operator, for the suites that assert what one is offered
 * (`D4.3`, ADR-0042, ADR-0036).
 *
 * **The session store is a constructor parameter in this harness rather than a
 * module to mock**, which is what makes principal-parameterised tests cheap:
 * rendering the same screen for an `admin` and for a `manager` is two calls,
 * with no `vi.mock` and no second route tree.
 *
 * Before `D4.3` every suite set an access token and no principal, which was
 * enough while nothing read one. It is not enough now: `can()` reads
 * `principal.roles`, and a `null` principal answers `false` for everything —
 * correctly, because it means "not yet known" — so a store with a token and no
 * principal renders the app an operator would see mid-bootstrap rather than the
 * one they end up in.
 */
export const staffPrincipal = (
  roles: readonly StaffRole[],
  overrides: Partial<StaffPrincipalResource> = {},
): StaffPrincipalResource => ({
  kind: "staff",
  id: "0198c1f0-0000-7000-8000-0000000000aa",
  email: "operator@machxi.local",
  firstName: "Ops",
  lastName: "Operator",
  roles,
  ...overrides,
});

/**
 * A store holding a live session for an operator with these roles.
 *
 * `admin` by default because it is what every D3-era suite implicitly assumed:
 * the roles that reach every screen without being the `super_admin` that
 * bypasses the policy table and would therefore prove nothing about it.
 */
export const authenticatedAs = (
  roles: readonly StaffRole[] = ["admin"],
): SessionStore => {
  const store = createSessionStore();

  store.setSession({
    accessToken: "test-access-token",
    principal: staffPrincipal(roles),
  });

  return store;
};
