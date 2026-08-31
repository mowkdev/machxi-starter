import type { UserPrincipalResource } from "@repo/contracts";

import {
  createSessionStore,
  type SessionStore,
} from "@/shared/api/session-store";

/**
 * A signed-in customer, for the suites that assert what one sees (ADR-0036).
 *
 * **The session store is a constructor parameter in this harness rather than a
 * module to mock**, which is what makes a scripted session cheap: rendering the
 * app signed in and signed out is two calls, with no `vi.mock` and no second
 * route tree.
 *
 * **No `roles` parameter, unlike the admin's `staffPrincipal`.** That one takes
 * a role list because `can()` reads it and a screen's contents depend on it;
 * this app mounts no policy table at all (ADR-0055 §3) — `customer` is the only
 * user role in v1, so authentication already implies it and there is nothing
 * for a test to vary. A parameter offering a choice the app cannot act on would
 * be the kind of speculative generality this deliverable is meant to catch.
 */
export const userPrincipal = (
  overrides: Partial<UserPrincipalResource> = {},
): UserPrincipalResource => ({
  kind: "user",
  id: "0198c1f0-0000-7000-8000-0000000000cc",
  email: "customer@machxi.local",
  firstName: "Cara",
  lastName: "Customer",
  roles: ["customer"],
  ...overrides,
});

/**
 * A store holding a live session.
 *
 * A principal as well as a token: a store with one and not the other is the
 * mid-bootstrap state rather than a signed-in customer, and a screen that
 * greets someone by name would render the wrong thing against it.
 */
export const authenticated = (
  overrides: Partial<UserPrincipalResource> = {},
): SessionStore => {
  const store = createSessionStore();

  store.setSession({
    accessToken: "test-access-token",
    principal: userPrincipal(overrides),
  });

  return store;
};
