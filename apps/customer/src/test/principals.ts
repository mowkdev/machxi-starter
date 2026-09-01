import type {
  ImpersonatorResource,
  UserPrincipalResource,
} from "@repo/contracts";

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
 * The staff member behind an impersonated session (`D13.7`, ADR-0057 §4).
 *
 * An id and an email, because that is the whole of `ImpersonatorResource`: the
 * banner names a person, the trail carries an id, and roles are deliberately
 * off the wire so nothing on this segment can authorise against them.
 */
export const impersonator = (
  overrides: Partial<ImpersonatorResource> = {},
): ImpersonatorResource => ({
  id: "0198c1f0-0000-7000-8000-0000000000a1",
  email: "operator@machxi.local",
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

/**
 * The same customer, reached through an impersonated session.
 *
 * The subject is unchanged and an actor is added — impersonation adds an
 * actor, it does not swap the subject (ADR-0057 §4) — which is exactly what
 * makes the banner's two names two names and not one.
 */
export const impersonated = (
  overrides: Partial<UserPrincipalResource> = {},
): SessionStore =>
  authenticated({ impersonatedBy: impersonator(), ...overrides });
