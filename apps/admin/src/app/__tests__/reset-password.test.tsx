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
 * `/reset-password` — where an operator's recovery link lands (`D18.6`,
 * ADR-0071 §4).
 *
 * Driven through the generated route tree on a memory history, because the
 * credential arrives in the **URL fragment** and a hand-built tree would be
 * asserting the test's own parsing. `renderApp` hands `initialPath` straight to
 * `createMemoryHistory`, so `#token=…` reaches the router exactly as a browser
 * would deliver it. This is the first route in this app whose credential
 * arrives that way.
 *
 * The store is empty: somebody following a recovery link is ordinarily
 * anonymous in this browser, and the page wears its own shell so `_auth`'s
 * mirror guard cannot redirect the exchange away when they are not.
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

  it("renders the dead-link screen and a way to another when the token is refused", async () => {
    const { user } = setup(link("a-dead-link"));

    await choose(user, NEW_PASSWORD);

    expect(
      await screen.findByText(/This link cannot be used/),
    ).toBeInTheDocument();
    /*
     * The screen's own sentence, not the catalogue's `UNAUTHENTICATED` one:
     * "Your session has ended. Sign in again." is false in every word here —
     * the reader is anonymous, nothing of theirs has ended, and signing in is
     * exactly what they cannot do.
     */
    expect(
      screen.queryByText(/Your session has ended/),
    ).not.toBeInTheDocument();

    // The way forward is a link, because a dead link's remedy is another one.
    expect(
      screen.getByRole("link", { name: "Ask for a new link" }),
    ).toHaveAttribute("href", "/forgot-password");
    // And the form is gone: no password would make that token work.
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });

  it("says the same thing when the address carries no link at all", async () => {
    setup("/reset-password");

    /*
     * Nothing in this app sends anybody here empty-handed, so the only way to
     * arrive without a fragment is a link that has lost one — the same
     * predicament as a link that has been spent, and the same sentence rather
     * than an invented distinction.
     */
    expect(
      await screen.findByText(/This link cannot be used/),
    ).toBeInTheDocument();
    expect(state.resetPasswordCalls).toEqual([]);
  });

  it("holds the link back from a password the policy refuses", async () => {
    const { user } = setup(link(RESET_TOKEN));

    await choose(user, "short");

    /*
     * `resetPasswordBody` is the object the API validates with (ADR-0011,
     * ADR-0023), so the rule is the rule — and the request never leaves,
     * because the endpoint carries the login limiter's argon2 budget
     * (ADR-0071 §4 as amended) and a body the schema refuses would spend it.
     */
    /*
     * The positive assertion first, so the case cannot pass by the submit
     * handler never running at all (`D18.6`, `code-reviewer`). The sentence is
     * zod's own rather than a key this app wrote, which is ADR-0046 §6's shape.
     */
    expect(
      await screen.findByText(/expected string to have >=12 characters/i),
    ).toBeInTheDocument();

    expect(state.resetPasswordCalls).toEqual([]);
    // Still the form, and still holding the link: a bad password is something
    // the person can fix by typing a better one.
    expect(screen.getByLabelText("New password")).toBeInTheDocument();
    expect(
      screen.queryByText(/This link cannot be used/),
    ).not.toBeInTheDocument();
  });
});
