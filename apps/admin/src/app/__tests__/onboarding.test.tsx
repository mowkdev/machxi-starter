import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import {
  ONBOARDING_TOKEN,
  createAuthHandlers,
  createAuthMockState,
  type AuthMockState,
} from "@/test/msw/handlers/auth.handlers";
import { server } from "@repo/app-kit/testing";
import { createSessionStore } from "@/shared/api/session-store";
import { renderApp } from "@/test/render";

/**
 * `/onboarding` — where an invited operator's link lands (`D18.11`, ADR-0071
 * §8).
 *
 * `/reset-password`'s suite one flow along, driven through the generated route
 * tree on a memory history for its reason: the credential arrives in the **URL
 * fragment**, and a hand-built tree would be asserting the test's own parsing.
 * `renderApp` hands `initialPath` straight to `createMemoryHistory`, so
 * `#token=…` reaches the router exactly as a browser would deliver it.
 *
 * What differs from that suite, and is the whole of what is worth proving
 * here: this link **ends in a session**. The reset revokes every session and
 * lands on sign-in; the accept answers login's body, so the store is written
 * and the dashboard is the landing.
 */

const CHOSEN_PASSWORD = "DevPassword!789";

const link = (token: string) =>
  `/onboarding#${new URLSearchParams({ token }).toString()}`;

let state: AuthMockState;

beforeEach(() => {
  state = createAuthMockState();
  server.use(...createAuthHandlers(state));
});

/**
 * The store is built here rather than read off the result, for the reason
 * `reset-password.test.tsx` gives: this app's `renderApp` returns the router
 * and the i18n instance and not the session, and what this suite has to be
 * able to ask is what was *put into* it.
 */
const setup = (initialPath: string) => {
  const store = createSessionStore();

  return {
    user: userEvent.setup(),
    store,
    ...renderApp({ initialPath, store }),
  };
};

const choose = async (
  user: ReturnType<typeof userEvent.setup>,
  password: string,
): Promise<void> => {
  await user.type(await screen.findByLabelText("Password"), password);
  await user.click(
    screen.getByRole("button", { name: "Save the password and sign in" }),
  );
};

describe("accepting an invitation from the link", () => {
  it("posts the token out of the fragment and lands signed in", async () => {
    const { user, router, store } = setup(link(ONBOARDING_TOKEN));

    expect(store.isAuthenticated()).toBe(false);

    await choose(user, CHOSEN_PASSWORD);

    await waitFor(() => {
      expect(store.isAuthenticated()).toBe(true);
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });

    expect(state.acceptOnboardingCalls).toEqual([
      { token: ONBOARDING_TOKEN, password: CHOSEN_PASSWORD },
    ]);
  });

  it("strikes the credential out of the address before anything is typed", async () => {
    const { router } = setup(link(ONBOARDING_TOKEN));

    /*
     * The token is not spent on arrival — it is waiting for a password — so
     * without the strike it sits in the address bar for however long somebody
     * takes to choose one: in the session history, in whatever a screen-share
     * is showing, and in a `Referer` the moment anything on the page loads a
     * third-party asset. Its life is seven days, the longest of the four.
     */
    expect(await screen.findByLabelText("Password")).toBeInTheDocument();

    await waitFor(() => {
      expect(router.state.location.hash).toBe("");
    });
    expect(router.history.location.href).not.toContain(ONBOARDING_TOKEN);
  });

  it("spends nothing on arrival, so a link cannot sign anybody in by itself", async () => {
    /*
     * The property that lets this screen skip the already-signed-in gate the
     * customer app's `/verify-email` needs (ADR-0071 §3 as amended at
     * `D18.4`): a client that spent a fragment on mount would be a
     * forced-login primitive on this app's own origin.
     */
    const { store } = setup(link(ONBOARDING_TOKEN));

    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
    expect(state.acceptOnboardingCalls).toEqual([]);
    expect(store.isAuthenticated()).toBe(false);
  });

  it("renders the dead-link screen when the token is refused", async () => {
    const { user, store } = setup(link("a-dead-link"));

    await choose(user, CHOSEN_PASSWORD);

    expect(
      await screen.findByText(/This link cannot be used/),
    ).toBeInTheDocument();
    /*
     * The screen's own sentence, not the catalogue's `UNAUTHENTICATED` one:
     * "Your session has ended. Sign in again." is false in every word here —
     * the reader is anonymous and has never had a session at all.
     */
    expect(
      screen.queryByText(/Your session has ended/),
    ).not.toBeInTheDocument();

    /*
     * And the way forward is an instruction rather than a button: unlike a
     * customer with a dead recovery link, an operator who has never had a
     * password cannot reach any sender in this app, so the only honest thing
     * to offer is sign-in and the sentence that says to ask an administrator.
     */
    expect(screen.getByText(/Ask an administrator/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to sign in" }),
    ).toHaveAttribute("href", "/login");

    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(store.isAuthenticated()).toBe(false);
  });

  it("says the same thing when the address carries no link at all", async () => {
    setup("/onboarding");

    // Nothing in this app sends anybody here empty-handed, so the only way to
    // arrive without a fragment is a link that has lost one — the same
    // predicament as a spent link, and the same sentence.
    expect(
      await screen.findByText(/This link cannot be used/),
    ).toBeInTheDocument();
    expect(state.acceptOnboardingCalls).toEqual([]);
  });
});
