import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import {
  RESET_TOKEN,
  createAuthHandlers,
  createAuthMockState,
  type AuthMockState,
} from "@/test/msw/handlers/auth.handlers";
import { server } from "@repo/app-kit/testing";
import {
  createSessionStore,
  type SessionStore,
} from "@/shared/api/session-store";
import { renderApp } from "@/test/render";

/**
 * `/reset-password` — where an operator's recovery link lands, through this app's door onto
 * `@repo/account` (`D22.2`, ADR-0077 §4; the screen is `D18.6`'s, ADR-0071
 * §4).
 *
 * **What the screen does is certified in the package**, in its own
 * `reset-password.test.tsx`: reading the token, holding it out of the
 * document, the dead-link screen, the password policy, the `429`. Those cases
 * moved there from this suite and its twin. What stays is what is about
 * **this app's route tree and router**, which the package stands in for and
 * so cannot prove:
 *
 * - the route is reachable outside both layout routes, with `#token=…`
 *   delivered by a memory history exactly as a browser would deliver it;
 * - the strike empties the *router's* location and its history entry;
 * - success lands on this tree's `/login`, and is not bounced by `_auth`'s
 *   authenticated-visitor guard when the browser held a session;
 * - the dead link's way forward is this tree's `/forgot-password`.
 *
 * The store is empty unless a case seeds it: somebody following a recovery
 * link is ordinarily anonymous in this browser.
 */

const NEW_PASSWORD = "DevPassword!456";

const link = (token: string) =>
  `/reset-password#${new URLSearchParams({ token }).toString()}`;

let state: AuthMockState;

beforeEach(() => {
  state = createAuthMockState();
  server.use(...createAuthHandlers(state));
});

/**
 * The store is built here rather than read off the result, because this app's
 * `renderApp` returns the router and the i18n instance and not the session —
 * and what this suite has to be able to ask is whether anything was taken out
 * of it. Passing one in is the harness's own contract; widening its return
 * type for one assertion would be a change to every suite's shape.
 */
const setup = (initialPath: string, seed?: () => SessionStore) => {
  const store = seed?.() ?? createSessionStore();

  return {
    user: userEvent.setup(),
    store,
    ...renderApp({ initialPath, store }),
  };
};

/** A browser that already holds a session when the link is followed. */
const signedIn = (): SessionStore => {
  const store = createSessionStore();

  store.setSession({ accessToken: "a-live-session" });

  return store;
};

const choose = async (
  user: ReturnType<typeof userEvent.setup>,
  password: string,
): Promise<void> => {
  await user.type(await screen.findByLabelText("New password"), password);
  await user.click(
    screen.getByRole("button", { name: "Save the new password" }),
  );
};

describe("choosing a new password from the link", () => {
  it("posts the token out of the fragment and lands on sign-in", async () => {
    const { user, router } = setup(link(RESET_TOKEN));

    await choose(user, NEW_PASSWORD);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/login");
    });

    expect(state.resetPasswordCalls).toEqual([
      { token: RESET_TOKEN, newPassword: NEW_PASSWORD },
    ]);
  });

  it("ends the session this browser was holding, and still lands on sign-in", async () => {
    /*
     * The case `/reset-password` sits outside both layout routes to allow: a
     * link followed in a browser that already holds a session. The endpoint
     * revokes **every** session of the account, this one included, so a client
     * that only declined to *write* would leave a token and a principal the
     * server has just killed — and `_auth`'s authenticated-visitor guard would
     * bounce the landing straight back to the dashboard (`D18.6`, both
     * reviewers, independently).
     *
     * The store is seeded rather than empty because the assertion is otherwise
     * one no implementation can fail.
     */
    const { user, router, store } = setup(link(RESET_TOKEN), signedIn);

    expect(store.isAuthenticated()).toBe(true);

    await choose(user, NEW_PASSWORD);

    await waitFor(() => {
      expect(store.isAuthenticated()).toBe(false);
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/login");
    });
  });

  it("strikes the credential out of the address before anything is typed", async () => {
    const { router } = setup(link(RESET_TOKEN));

    /*
     * The token is not spent on arrival, so without the strike it sits in the
     * address bar for however long somebody takes to choose a password — in
     * the session history, in whatever a screen-share is showing, and in a
     * `Referer` the moment anything on the page loads a third-party asset.
     */
    expect(await screen.findByLabelText("New password")).toBeInTheDocument();

    await waitFor(() => {
      expect(router.state.location.hash).toBe("");
    });
    expect(router.history.location.href).not.toContain(RESET_TOKEN);
  });

  it("sends a dead link's reader to this app's own /forgot-password", async () => {
    /*
     * The dead-link screen is the package's; the link on it is this app's
     * router's `Link`, passed as a rendered child because a router types its
     * destinations against its own route tree (ADR-0077 §2). So what is
     * proved here is the destination: that following it lands on the route
     * this tree has, with the form the same door binds.
     */
    const { user, router } = setup("/reset-password");

    await user.click(
      await screen.findByRole("link", { name: "Ask for a new link" }),
    );

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/forgot-password");
    });
    expect(
      await screen.findByRole("button", { name: "Email me a link" }),
    ).toBeInTheDocument();
    expect(state.resetPasswordCalls).toEqual([]);
  });
});
