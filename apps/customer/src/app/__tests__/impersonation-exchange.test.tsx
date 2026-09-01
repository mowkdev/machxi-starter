import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  HANDOFF_TOKEN,
  IMPERSONATOR,
  createAuthHandlers,
  createAuthMockState,
  type AuthMockState,
} from "@/test/msw/handlers/auth.handlers";
import {
  createProfileHandlers,
  createProfileMockState,
} from "@/test/msw/handlers/profile.handlers";
import { server } from "@/test/msw/server";
import { authenticated } from "@/test/principals";
import { renderApp } from "@/test/render";

/**
 * `/impersonate` — the exchange screen (`D13.7`, ADR-0057 §3, §7).
 *
 * Driven through the generated route tree on a memory history, because the
 * credential arrives in the **URL fragment** and a hand-built tree would be
 * asserting the test's own parsing. `renderApp` hands `initialPath` straight
 * to `createMemoryHistory`, so `#token=…` reaches the router exactly as a
 * browser would deliver it.
 *
 * The store is empty in every case but the last: an operator following the
 * admin panel's link is usually anonymous in this browser, and the one case
 * where they are not is the one ADR-0057 §3 decides explicitly.
 */

const link = (token: string) =>
  `/impersonate#${new URLSearchParams({ token }).toString()}`;

let auth: AuthMockState;

beforeEach(() => {
  auth = createAuthMockState();
  server.use(
    ...createAuthHandlers(auth),
    ...createProfileHandlers(createProfileMockState()),
  );
});

describe("redeeming a handoff", () => {
  it("spends the token, starts the session and lands home", async () => {
    const { store, router } = renderApp({ initialPath: link(HANDOFF_TOKEN) });

    expect(
      await screen.findByRole("heading", { name: "Your account" }),
    ).toBeInTheDocument();

    expect(auth.impersonateCalls).toEqual([HANDOFF_TOKEN]);
    expect(router.state.location.pathname).toBe("/");
    expect(store.isAuthenticated()).toBe(true);

    /*
     * The fact on the principal and nowhere else (ADR-0057 §4) — which is what
     * the banner then renders from, so this assertion and the banner suite's
     * are the two halves of one claim.
     */
    const principal = store.getPrincipal();

    expect(principal?.kind === "user" && principal.impersonatedBy).toEqual(
      IMPERSONATOR,
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      IMPERSONATOR.email,
    );
  });

  it("asks for cookie transport, or the session dies on the first reload", async () => {
    renderApp({ initialPath: link(HANDOFF_TOKEN) });

    await waitFor(() => {
      expect(auth.impersonateCalls).toHaveLength(1);
    });

    /*
     * `COOKIE_TRANSPORT_PATHS` in `@repo/api-client`, asserted from the app
     * that depends on it. Without the header the API answers with a body-borne
     * refresh token and sets no cookie (ADR-0029 §Opt-in, ADR-0057 §3): every
     * assertion above would still pass, and the first reload would land the
     * operator on the sign-in screen. Nothing in the response says which
     * happened, so the assertion is on the request.
     */
    expect(auth.impersonateAskedForCookies).toBe(true);
  });

  it("strikes the credential out of the address", async () => {
    const { router } = renderApp({ initialPath: link(HANDOFF_TOKEN) });

    await waitFor(() => {
      expect(auth.impersonateCalls).toHaveLength(1);
    });

    /*
     * A one-time credential must not sit in the address bar, in the session
     * history or in whatever a screen-share is showing — and a *refused*
     * exchange deliberately does not spend it (ADR-0057 §3), so the window in
     * which a lingering token is still live is real rather than theoretical.
     * `replace`, so Back cannot walk to the entry that carried it.
     */
    await waitFor(() => {
      expect(router.state.location.hash).toBe("");
    });
    expect(router.history.length).toBe(1);
  });

  it("says so, and starts nothing, when the exchange is refused", async () => {
    const { store } = renderApp({ initialPath: link("a-dead-handoff") });

    expect(
      await screen.findByText(/This link cannot be used/),
    ).toBeInTheDocument();

    expect(auth.impersonateCalls).toEqual(["a-dead-handoff"]);
    expect(store.isAuthenticated()).toBe(false);
    /*
     * One indistinguishable `401` for every cause (ADR-0057 §3), so there is
     * one sentence and no branch. The way forward is a fresh mint, which is
     * what the link offers.
     */
    expect(
      screen.getByRole("link", { name: "Go to sign in" }),
    ).toBeInTheDocument();
  });

  it("asks for nothing at all when the address carries no token", async () => {
    renderApp({ initialPath: "/impersonate" });

    expect(
      await screen.findByText(/This address needs a link/),
    ).toBeInTheDocument();

    // Not a refusal: nothing was offered, so nothing was posted. MSW runs with
    // `onUnhandledRequest: "error"`, so a stray request would have failed the
    // render rather than this line.
    expect(auth.impersonateCalls).toEqual([]);
  });

  it("leaves nothing unaccented on the state a person sits on", async () => {
    /*
     * ADR-0046 §14's walk reaches `/impersonate` — it is a leaf of the
     * generated tree — but only ever in its `missing` state, so
     * `exchange.refused` is copy the lens would otherwise never see
     * (`adr-reviewer`, `D13.7`). Under the lens every translated string is
     * bracketed and accented, so an English sentence hardcoded here would be
     * the only readable thing on the screen.
     */
    renderApp({ initialPath: link("a-dead-handoff"), pseudo: true });

    await waitFor(() => {
      expect(auth.impersonateCalls).toHaveLength(1);
    });

    await waitFor(() => {
      expect(document.body.textContent ?? "").toContain("[");
    });

    expect(document.body.textContent ?? "").not.toContain(
      "This link cannot be used",
    );
    expect(screen.getByRole("link").textContent ?? "").toContain("[");
  });

  it("overwrites a real customer session already in this browser", async () => {
    /*
     * ADR-0057 §3's operator decision, from the client's side: the exchange
     * overwrites the cookies of a session that is already here and leaves its
     * row alive on the server. Refusing would break every staff member who is
     * also a customer; revoking would end a session that was not the actor's
     * to end.
     */
    const { store } = renderApp({
      initialPath: link(HANDOFF_TOKEN),
      store: authenticated({ email: "someone.else@machxi.local" }),
    });

    expect(await screen.findByRole("status")).toHaveTextContent(
      IMPERSONATOR.email,
    );

    const principal = store.getPrincipal();

    expect(principal?.email).toBe("customer@machxi.local");
    expect(principal?.kind === "user" && principal.impersonatedBy).toEqual(
      IMPERSONATOR,
    );
  });
});
