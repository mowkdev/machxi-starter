import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { describe, expect, it } from "vitest";

import { createApiClient } from "@/shared/api/client";
import { createSessionStore } from "@/shared/api/session-store";
import {
  API,
  createAuthHandlers,
  createAuthMockState,
} from "@/test/msw/handlers/auth.handlers";
import { server } from "@repo/app-kit/testing";
import { renderApp } from "@/test/render";

/**
 * Signing out, from the account menu in the dashboard shell.
 *
 * Driven through the real route tree, so what is asserted is the join no other
 * suite covers: the feature clears the session, and the operator ends up on
 * the login screen rather than on a dashboard whose every request would fail.
 */
const setup = () => {
  const store = createSessionStore();
  const client = createApiClient({
    store,
    baseUrl: "http://api.test",
    segment: "admin",
  });

  server.use(...createAuthHandlers(createAuthMockState()));
  store.setSession({ accessToken: "live-token", csrfToken: "live-csrf" });

  return {
    store,
    user: userEvent.setup(),
    ...renderApp({ initialPath: "/", store, client }),
  };
};

const signOut = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole("button", { name: /account/i }));
  await user.click(await screen.findByRole("menuitem", { name: /sign out/i }));
};

describe("logout", () => {
  it("clears the session and lands on the login screen", async () => {
    const { user, store } = setup();

    await signOut(user);

    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(store.isAuthenticated()).toBe(false);
    expect(store.getCsrfToken()).toBeNull();
  });

  it("still ends the session when the API cannot be reached", async () => {
    const { user, store } = setup();

    server.use(http.post(`${API}/auth/logout`, () => Response.error()));

    await signOut(user);

    // A client that cannot reach the API must still end what it controls; the
    // server-side session dies at its TTL. The failure must not surface as an
    // unhandled rejection either, which is why `logout` is caught at the call
    // site even though there is nothing to show the operator.
    await waitFor(() => {
      expect(store.isAuthenticated()).toBe(false);
    });
    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
  });
});
