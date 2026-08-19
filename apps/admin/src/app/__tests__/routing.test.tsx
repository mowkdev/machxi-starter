import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  createSessionStore,
  type SessionStore,
} from "@/shared/api/session-store";
import { renderApp } from "@/test/render";

/**
 * The route tree, its two pathless layouts and the guards on them (ADR-0032
 * §Layout topology), asserted through the real generated tree.
 *
 * This is the suite the structural-guard claim rests on. ADR-0032 rejects a
 * `<RequireAuth>` wrapper because it is a guard every new page has to remember;
 * what replaces it is a redirect in `beforeLoad` on a layout route, and the
 * only way to know that actually protects a page is to mount the page and see
 * where the router lands. A test that re-declared its own route tree would
 * prove the test's tree instead.
 *
 * The session is scripted rather than stubbed globally, which is what `D3.4`
 * will do for real: the guard reads `context.session`, so a test that hands the
 * router a different session is exercising the production path.
 */

/*
 * A real store rather than a shape-compatible fake: the guard reads
 * `isAuthenticated()`, which is derived from the access token's presence
 * (ADR-0033), so a fake that answered the predicate directly would stop
 * testing the derivation the moment it changed.
 */
const session = (isAuthenticated: boolean): SessionStore => {
  const store = createSessionStore();

  if (isAuthenticated) store.setSession({ accessToken: "test-access-token" });

  return store;
};

describe("route guards", () => {
  it("sends an unauthenticated visitor from a protected page to /login", async () => {
    renderApp({ initialPath: "/staff", store: session(false) });

    // The login screen, inside the `_auth` shell — not the dashboard.
    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("sends an authenticated visitor away from /login", async () => {
    renderApp({ initialPath: "/login", store: session(true) });

    // The mirror guard on `_auth`: a signed-in operator has no business here.
    expect(
      await screen.findByRole("heading", { name: "Dashboard" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Sign in" }),
      ).not.toBeInTheDocument();
    });
  });

  it("renders a protected page inside the dashboard shell", async () => {
    renderApp({ initialPath: "/staff", store: session(true) });

    expect(
      await screen.findByRole("heading", { name: "Staff" }),
    ).toBeInTheDocument();
    // The shell, not just the page: the sidebar-07 navigation is what makes
    // `_dashboard` a layout rather than a guard with no body.
    expect(screen.getByRole("link", { name: "Users" })).toBeInTheDocument();
  });

  it("titles the shell from the route's own staticData", async () => {
    renderApp({ initialPath: "/profile", store: session(true) });

    // Declared on the route rather than looked up in the layout, so a page and
    // its heading cannot drift apart.
    expect(
      await screen.findByRole("heading", { name: "Profile" }),
    ).toBeInTheDocument();
  });
});
