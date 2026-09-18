import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { describe, expect, it } from "vitest";

import { createApiClient } from "@/shared/api/client";
import { createSessionStore } from "@/shared/api/session-store";
import {
  API,
  CREDENTIALS,
  createAuthHandlers,
  createAuthMockState,
} from "@/test/msw/handlers/auth.handlers";
import { fail, server } from "@repo/app-kit/testing";
import { renderApp } from "@/test/render";

/**
 * The login screen, driven the way an operator drives it (ADR-0036: query by
 * role and accessible name, act with `user-event`, assert what a user sees).
 *
 * It renders through the real route tree, so the `_auth` layout, the route's
 * `validateSearch` and the redirect after success are all exercised rather than
 * re-declared.
 */

const setup = ({ path = "/login" }: { path?: string } = {}) => {
  const store = createSessionStore();
  const client = createApiClient({
    store,
    baseUrl: "http://api.test",
    segment: "admin",
  });

  server.use(...createAuthHandlers(createAuthMockState()));

  return {
    store,
    user: userEvent.setup(),
    ...renderApp({ initialPath: path, store, client }),
  };
};

const signIn = async (
  user: ReturnType<typeof userEvent.setup>,
  email: string = CREDENTIALS.email,
  password: string = CREDENTIALS.password,
) => {
  await user.type(await screen.findByLabelText("Email"), email);
  await user.type(await screen.findByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
};

describe("login", () => {
  it("signs in and lands on the dashboard", async () => {
    const { user, store } = setup();

    await signIn(user);

    expect(
      await screen.findByRole("heading", { name: "Dashboard" }),
    ).toBeInTheDocument();
    // The client hydrated the store, which is what the guard reads.
    expect(store.isAuthenticated()).toBe(true);
    expect(store.getPrincipal()?.email).toBe(CREDENTIALS.email);
  });

  it("returns the operator to the page the guard turned away", async () => {
    const { user } = setup({ path: "/login?redirect=%2Fstaff" });

    await signIn(user);

    // The round trip `_dashboard`'s guard started: it recorded the attempted
    // location, the route validated it as same-origin, and this is where it
    // gets spent.
    expect(
      await screen.findByRole("heading", { name: "Staff" }),
    ).toBeInTheDocument();
  });

  it("validates against the contract before sending anything", async () => {
    const { user, store } = setup();
    let requests = 0;

    server.use(
      http.post(`${API}/auth/login`, () => {
        requests += 1;
        return fail(401, "AUTH_INVALID_CREDENTIALS");
      }),
    );

    await signIn(user, "not-an-email", "x");

    // `loginBody` is the same object the API validates with (ADR-0011/0023), so
    // a field the server would reject is one the client never sends. The
    // assertion is on `role="alert"` rather than on the text, which would also
    // match the field's own label.
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.length).toBeGreaterThan(0);
    expect(requests).toBe(0);
    expect(store.isAuthenticated()).toBe(false);
  });

  it("shows the API's message when the credentials are wrong", async () => {
    const { user, store } = setup();

    await signIn(user, CREDENTIALS.email, "WrongPassword!123");

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(store.isAuthenticated()).toBe(false);
    // Still on the login screen: a failed sign-in navigates nowhere.
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("disables every field while the request is in flight", async () => {
    const { user } = setup();
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    server.use(
      http.post(`${API}/auth/login`, async () => {
        await held;
        return fail(401, "AUTH_INVALID_CREDENTIALS");
      }),
    );

    await signIn(user);

    // The rule ADR-0035's machinery will later enforce for every form, honoured
    // here by hand: nothing is editable and nothing is re-submittable until the
    // request settles, success or failure.
    await waitFor(() => {
      expect(screen.getByLabelText("Email")).toBeDisabled();
    });
    expect(screen.getByLabelText("Password")).toBeDisabled();
    expect(screen.getByRole("button", { name: /signing in/i })).toBeDisabled();

    release?.();

    await waitFor(() => {
      expect(screen.getByLabelText("Email")).toBeEnabled();
    });
  });
});
