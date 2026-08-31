import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";

import { useSignOut } from "@/features/auth";

import { createApiClient } from "@/shared/api/client";
import { ApiProvider } from "@/shared/api/context";
import { EN_RESOURCES, NAMESPACES, createI18n } from "@/shared/i18n";

import {
  API,
  createAuthHandlers,
  createAuthMockState,
} from "@/test/msw/handlers/auth.handlers";
import { server } from "@/test/msw/server";
import { authenticated } from "@/test/principals";

/**
 * Ending the session (ADR-0033).
 *
 * `useSignOut` has no host until `D12.5` puts a control in ADR-0053's slim
 * popover, which is why the behaviour is a hook and not the admin's
 * `LogoutMenuItem`. So this suite supplies the two things the hook needs and
 * nothing else: an `ApiProvider` over a scripted store, and a router with a
 * `/login` in it.
 *
 * **The route tree here is the harness's, not the app's, and that is a
 * deliberate limit on what this file claims.** ADR-0036's rule — a guard
 * asserted against a hand-built tree only proves the test's tree — is about
 * *routing*, and no routing decision is asserted below: the app's own guards
 * and redirects are `app/__tests__/routing.test.tsx`'s, over the generated
 * tree. What is asserted here is the hook's own contract, which is exactly the
 * part that has no address yet: the session is cleared, it is cleared even when
 * the request fails, a second click cannot start a second request, and the
 * destination is `/login` rather than whatever a guard would have computed.
 * `D12.5` drives the same behaviour through the real popover in the real tree.
 */

const SignOutButton = () => {
  const { signOut, pending } = useSignOut();

  return (
    <button disabled={pending} onClick={signOut} type="button">
      Sign out
    </button>
  );
};

const rootRoute = createRootRoute({ component: Outlet });

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: SignOutButton,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: () => <p>Signed out</p>,
});

const setup = () => {
  const state = createAuthMockState();
  server.use(...createAuthHandlers(state));

  const store = authenticated();
  const client = createApiClient({
    store,
    baseUrl: "http://api.test",
    segment: "user",
  });
  const i18n = createI18n({
    resources: { en: EN_RESOURCES },
    namespaces: NAMESPACES,
    locale: "en",
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([homeRoute, loginRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  render(
    <ApiProvider value={{ client, store }}>
      <I18nextProvider i18n={i18n.instance}>
        {/*
         * The harness's router is not this app's registered one, which is what
         * the assertion is: `RouterProvider` is generic over any router, and
         * the `Register` augmentation in `app/providers/router.tsx` only pins
         * what `useNavigate`'s *paths* type-check against.
         */}
        <RouterProvider router={router} />
      </I18nextProvider>
    </ApiProvider>,
  );

  return { state, store, user: userEvent.setup() };
};

const click = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole("button", { name: "Sign out" }));
};

describe("signing out", () => {
  it("clears the session and lands on /login", async () => {
    const { user, store, state } = setup();

    expect(store.isAuthenticated()).toBe(true);

    await click(user);

    expect(await screen.findByText("Signed out")).toBeInTheDocument();
    expect(store.isAuthenticated()).toBe(false);
    expect(store.getCsrfToken()).toBeNull();
    expect(state.logoutCalls).toBe(1);
  });

  it("ends the session locally even when the request fails", async () => {
    const { user, store } = setup();

    server.use(http.post(`${API}/auth/logout`, () => Response.error()));

    await click(user);

    /*
     * The case the design deliberately supports: someone who has lost
     * connectivity and wants to be signed out of a shared machine must be
     * signed out of it. The client clears locally before it re-throws, and the
     * hook's `catch` is there because that rejection is by design — swallowing
     * it is what stops a working feature being reported as a crash.
     */
    await waitFor(() => {
      expect(store.isAuthenticated()).toBe(false);
    });
    expect(await screen.findByText("Signed out")).toBeInTheDocument();
  });

  it("does not start a second request while the first is in flight", async () => {
    const { user, state } = setup();
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    server.use(
      http.post(`${API}/auth/logout`, async () => {
        state.logoutCalls += 1;
        await held;
        return new Response(null, { status: 204 });
      }),
    );

    const button = await screen.findByRole("button", { name: "Sign out" });

    await user.click(button);
    await waitFor(() => {
      expect(button).toBeDisabled();
    });

    release?.();

    await waitFor(() => {
      expect(state.logoutCalls).toBe(1);
    });
  });
});
