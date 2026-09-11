import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { createSessionStore } from "@/shared/api/session-store";
import {
  createAuthHandlers,
  createAuthMockState,
} from "@/test/msw/handlers/auth.handlers";
import {
  createOrganizationsHandlers,
  createOrganizationsMockState,
} from "@/test/msw/handlers/organizations.handlers";
import { server } from "@repo/app-kit/testing";
import { authenticated } from "@/test/principals";
import { renderApp } from "@/test/render";

/**
 * The route tree, its two pathless layouts and the guards on them (ADR-0049
 * §Layout topology), asserted through the real generated tree.
 *
 * This is the suite the structural-guard claim rests on. ADR-0049 rejects a
 * `<RequireAuth>` wrapper because it is a guard every new page has to remember;
 * what replaces it is a redirect in `beforeLoad` on a layout route, and the
 * only way to know that actually protects a page is to mount the page and see
 * where the router lands. A test that re-declared its own route tree would
 * prove the test's tree instead.
 *
 * The store is real rather than a shape-compatible fake: the guard reads
 * `isAuthenticated()`, which is derived from the access token's presence
 * (ADR-0033), so a fake that answered the predicate directly would stop testing
 * the derivation the moment it changed.
 */
/*
 * The one request every protected screen now makes (`D15.5`, ADR-0067 §6): the
 * switcher reads `GET /user/orgs` from the shell's header. This file is about
 * where the router lands rather than about what a screen shows, and it lands on
 * protected screens — so the endpoint is answered here rather than left to fail
 * behind assertions that would not notice.
 */
beforeEach(() => {
  server.use(...createOrganizationsHandlers(createOrganizationsMockState()));
});

describe("route guards", () => {
  it("sends an unauthenticated visitor from a protected page to /login", async () => {
    const { router } = renderApp({
      initialPath: "/",
      store: createSessionStore(),
    });

    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Your account" }),
    ).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("records the attempted location so the sign-in can spend it", async () => {
    const { router } = renderApp({
      initialPath: "/",
      store: createSessionStore(),
    });

    await screen.findByRole("heading", { name: "Sign in" });

    /*
     * The other half of the round trip the login suite finishes. It is asserted
     * here rather than only there because the guard is what *writes* the value:
     * a redirect that dropped it would still land on `/login` and still pass
     * every visible assertion, while quietly losing the screen someone was on
     * when their session expired.
     */
    expect(router.state.location.search).toEqual({ redirect: "/" });
  });

  it("sends an authenticated visitor away from /login", async () => {
    renderApp({ initialPath: "/login", store: authenticated() });

    // The mirror guard on `_auth`: someone signed in has no business here.
    expect(
      await screen.findByRole("heading", { name: "Your account" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Sign in" }),
      ).not.toBeInTheDocument();
    });
  });

  it("renders a protected page for an authenticated visitor", async () => {
    const { router } = renderApp({ initialPath: "/", store: authenticated() });

    expect(
      await screen.findByRole("heading", { name: "Your account" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
  });

  it("keeps the protected tree protected when the session dies mid-session", async () => {
    const store = authenticated();
    const { router } = renderApp({ initialPath: "/", store });

    await screen.findByRole("heading", { name: "Your account" });

    /*
     * The state ADR-0033's `onSessionEnded` leaves behind, reached directly:
     * the store is empty and the guards have been asked again. The next case
     * drives the same thing through the client, which is the production path;
     * this one pins the guard's own answer without a request in the way.
     */
    store.clear();
    await router.invalidate();

    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
  });

  it("ejects the customer when the client declares the session over", async () => {
    /*
     * The whole ADR-0033 join, end to end: a terminal code comes back, the
     * client clears the store and calls `onSessionEnded`, the router
     * invalidates, `beforeLoad` runs again and the guard — the one place that
     * owns the decision (ADR-0049) — sends them to `/login`.
     *
     * **This case exists because `D12.2`'s review found the join unreachable.**
     * The handler used to be registered at module scope against the
     * module-scope router, so no test could touch it: deleting the
     * registration left lint, types and the whole suite green while a customer
     * whose session died mid-use sat on a protected screen with an empty
     * store. `createAppRouter` takes the registrar now, and this is what makes
     * that a claim rather than a comment.
     */
    const state = createAuthMockState();
    state.refreshFailsWith = { status: 401, code: "AUTH_SESSION_REVOKED" };
    server.use(...createAuthHandlers(state));

    const store = authenticated();
    const { client } = renderApp({ initialPath: "/", store });

    await screen.findByRole("heading", { name: "Your account" });

    // A refresh the server refuses terminally. The client is the thing under
    // test here, so it is driven rather than simulated.
    await expect(client.refreshSession()).rejects.toThrow();

    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(store.isAuthenticated()).toBe(false);
  });

  it("offers the way to /register when the build has registration on", async () => {
    const { user } = {
      user: userEvent.setup(),
      ...renderApp({ initialPath: "/login", store: createSessionStore() }),
    };

    /*
     * The positive control the next case needs: without it a link that stopped
     * rendering for *everybody* — a renamed key, a deleted element — would
     * leave the flag-off assertion green while proving nothing.
     */
    await user.click(
      await screen.findByRole("link", { name: "Create an account" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Create an account" }),
    ).toBeInTheDocument();
  });

  it("makes /register and its link absent when the build has registration off", async () => {
    const { router } = renderApp({
      initialPath: "/login",
      store: createSessionStore(),
      features: { userRegistration: false, googleSignIn: false },
    });

    await screen.findByRole("heading", { name: "Sign in" });

    // The link first: a screen that offered a way into an address answering
    // not-found would be the two halves of the flag disagreeing.
    expect(
      screen.queryByRole("link", { name: "Create an account" }),
    ).not.toBeInTheDocument();

    /*
     * And the address itself. `notFound()` from the route's `beforeLoad`
     * renders the same sentence an unknown path gets — the client's echo of
     * the API's own choice, which is `404 ROUTE_NOT_FOUND` rather than a `403`
     * that would confirm the feature is there and merely switched off
     * (ADR-0004). The location is asserted beside the copy because a redirect
     * to `/login` would also have produced a screen with no sign-up on it, and
     * that is the behaviour this route deliberately does not have.
     */
    await router.navigate({ to: "/register" });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That address does not exist.",
    );
    expect(router.state.location.pathname).toBe("/register");
  });

  it("shows a written sentence, not a stack, for an address that matches nothing", async () => {
    /*
     * The router's own `defaultNotFoundComponent` is a bare "Not Found"; its
     * `defaultErrorComponent` is worse — a **Show Error** button that prints
     * `error.message`, which for anything rejecting out of a route is the
     * API's developer-facing English default (ADR-0013). Both are replaced in
     * `createAppRouter`, and this is the assertion that keeps them replaced.
     */
    renderApp({ initialPath: "/no-such-page", store: authenticated() });

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent("That address does not exist.");
  });
});
