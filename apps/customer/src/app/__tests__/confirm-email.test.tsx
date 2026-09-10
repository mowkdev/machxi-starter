import { cleanup, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  EMAIL_CHANGE_TOKEN,
  createAuthHandlers,
  createAuthMockState,
  type AuthMockState,
} from "@/test/msw/handlers/auth.handlers";
import { server } from "@repo/app-kit/testing";
import { renderApp } from "@/test/render";

/**
 * `/confirm-email` — where an address change's link lands (`D18.9`,
 * ADR-0071 §6).
 *
 * Driven through the generated route tree on a memory history, which is
 * `/reset-password`'s and `/verify-email`'s harness and for their reason: the
 * credential arrives in the **URL fragment**, and a hand-built tree would be
 * asserting the test's own parsing rather than the router's. `renderApp` hands
 * `initialPath` straight to `createMemoryHistory`, so `#token=…` reaches the
 * router exactly as a browser would deliver it.
 *
 * The store is empty in every case here, and that is the flow rather than a
 * convenience: this link is mailed to the address the account is moving **to**,
 * so the browser that opens it has usually never signed in at all. The page
 * wears its own shell for exactly that reason — under `_dashboard` an
 * anonymous arrival would be bounced to `/login` with the fragment nowhere.
 */

const link = (token: string) =>
  `/confirm-email#${new URLSearchParams({ token }).toString()}`;

let state: AuthMockState;

beforeEach(() => {
  state = createAuthMockState();
  server.use(...createAuthHandlers(state));
});

describe("confirming a new address from the link", () => {
  it("posts the token out of the fragment and says the address has moved", async () => {
    renderApp({ initialPath: link(EMAIL_CHANGE_TOKEN) });

    expect(
      await screen.findByText(
        /Your email address has been changed\. Use the new one to sign in/,
      ),
    ).toBeInTheDocument();

    expect(state.confirmEmailCalls).toEqual([{ token: EMAIL_CHANGE_TOKEN }]);
  });

  it("strikes the credential out of the address as soon as it is read", async () => {
    const { router } = renderApp({ initialPath: link(EMAIL_CHANGE_TOKEN) });

    /*
     * A refused consumption spends nothing (ADR-0071 §1), so a link refused
     * because the account was disabled for an afternoon stays redeemable for
     * the rest of its hour — in the session history, in whatever a screen
     * share is showing, and in a `Referer` the moment the page loads anything
     * third-party. `replace`, so Back cannot walk to the entry that carried it.
     */
    await waitFor(() => {
      expect(router.state.location.hash).toBe("");
    });

    expect(router.state.location.pathname).toBe("/confirm-email");
  });

  it("spends the link once, however many times the screen renders", async () => {
    // `StrictMode` double-invokes effects in development, and a second post
    // would be answered `401` on a link that had just worked.
    renderApp({ initialPath: link(EMAIL_CHANGE_TOKEN) });

    await waitFor(() => {
      expect(state.confirmEmailCalls).toHaveLength(1);
    });

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    expect(state.confirmEmailCalls).toHaveLength(1);
  });

  it("tells a reader whose address was taken meanwhile to start again", async () => {
    // The one refusal §6 makes distinguishable: whoever holds this link
    // already knows which address it names, so there is no existence to
    // conceal — and it is the only failure here a *different* address fixes.
    state.confirmEmailTaken = true;

    renderApp({ initialPath: link(EMAIL_CHANGE_TOKEN) });

    expect(
      await screen.findByText(/This address now belongs to another account/),
    ).toBeInTheDocument();
  });

  it("says the same thing for a refused link as for no link at all", async () => {
    renderApp({ initialPath: link("a-token-nobody-minted") });

    expect(
      await screen.findByText(/This link cannot be used/),
    ).toBeInTheDocument();

    /*
     * And an arrival with no fragment gets the identical sentence without a
     * request being made: nothing in this app sends anybody here empty-handed,
     * so an address with no token is a link that lost one — the same
     * predicament as a link that has been spent (ADR-0071 §6).
     *
     * `cleanup()` first, and it is the assertion rather than tidiness
     * (`D18.9`'s `code-reviewer`): the tree above is still mounted until the
     * `afterEach`, so a query against `document.body` would match its sentence
     * and pass whatever the second arrival rendered — including a screen stuck
     * on `pending` forever.
     */
    cleanup();
    server.resetHandlers();
    state = createAuthMockState();
    server.use(...createAuthHandlers(state));

    renderApp({ initialPath: "/confirm-email" });

    expect(
      await screen.findByText(/This link cannot be used/),
    ).toBeInTheDocument();
    expect(state.confirmEmailCalls).toHaveLength(0);
  });

  it("offers the way to sign in, because it can offer nothing else", async () => {
    /*
     * The endpoint issues no session (§6), so unlike `/verify-email` there is
     * nowhere for this screen to navigate to — and the browser holding the new
     * mailbox is usually not one that has ever signed in to this account.
     */
    renderApp({ initialPath: link(EMAIL_CHANGE_TOKEN) });

    expect(
      await screen.findByRole("link", { name: "Go to sign in" }),
    ).toBeInTheDocument();
  });
});
