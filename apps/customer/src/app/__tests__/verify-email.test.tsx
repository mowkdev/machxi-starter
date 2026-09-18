import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import {
  PRINCIPAL,
  PUBLIC_API,
  VERIFICATION_TOKEN,
  createAuthHandlers,
  createAuthMockState,
  type AuthMockState,
} from "@/test/msw/handlers/auth.handlers";
import { fail, server } from "@repo/app-kit/testing";
import {
  createProfileHandlers,
  createProfileMockState,
} from "@/test/msw/handlers/profile.handlers";
import {
  createOrganizationsHandlers,
  createOrganizationsMockState,
} from "@/test/msw/handlers/organizations.handlers";
import { createSessionStore } from "@/shared/api/session-store";
import { authenticated } from "@/test/principals";
import { renderApp } from "@/test/render";

/**
 * `/verify-email` — the confirmation screen (`D18.4`, ADR-0071 §3).
 *
 * Driven through the generated route tree on a memory history, because the
 * credential arrives in the **URL fragment** and a hand-built tree would be
 * asserting the test's own parsing. `renderApp` hands `initialPath` straight
 * to `createMemoryHistory`, so `#token=…` reaches the router exactly as a
 * browser would deliver it.
 *
 * The store is empty in most cases: somebody following a confirmation link is
 * usually anonymous in this browser, and the page wears its own shell so
 * `_auth`'s mirror guard cannot redirect the exchange away when they are not.
 * The two cases that *do* start with a session are the gate `D18.4`'s
 * `security-reviewer` asked for — the link is held rather than spent until
 * somebody says so (ADR-0071 §3 as amended).
 */

const link = (token: string) =>
  `/verify-email#${new URLSearchParams({ token }).toString()}`;

let auth: AuthMockState;

beforeEach(() => {
  auth = createAuthMockState();
  server.use(
    ...createAuthHandlers(auth),
    ...createProfileHandlers(createProfileMockState()),
    /*
     * The switcher reads `GET /user/orgs` from the shell's header (`D15.5`),
     * so the home screen this lands on makes the request. Answered rather than
     * left unhandled, because a suite whose shell is half-failed is a suite
     * certifying a screen nobody ships.
     */
    ...createOrganizationsHandlers(createOrganizationsMockState()),
  );
});

const setup = (initialPath: string) => ({
  user: userEvent.setup(),
  // An empty store: the ordinary arrival is anonymous, and a session here
  // would make "the exchange started one" true before anything happened.
  ...renderApp({ initialPath, store: createSessionStore() }),
});

describe("confirming an address", () => {
  it("spends the token, starts the session and lands home", async () => {
    const { store, router } = setup(link(VERIFICATION_TOKEN));

    expect(
      await screen.findByRole("heading", { name: "Your account" }),
    ).toBeInTheDocument();

    expect(auth.verifyEmailCalls).toEqual([VERIFICATION_TOKEN]);
    expect(router.state.location.pathname).toBe("/");
    expect(store.isAuthenticated()).toBe(true);
    expect(store.getPrincipal()?.email).toBe(PRINCIPAL.email);
  });

  it("asks for cookie transport, or the session dies on the first reload", async () => {
    setup(link(VERIFICATION_TOKEN));

    await waitFor(() => {
      expect(auth.verifyEmailCalls).toHaveLength(1);
    });

    /*
     * `COOKIE_TRANSPORT_PATHS` in `@repo/api-client`, asserted from the app
     * that depends on it. Without the header the API answers with a body-borne
     * refresh token and sets no cookie (ADR-0029 §Opt-in): every assertion
     * above would still pass, and the first reload would land the customer on
     * the sign-in screen — with the one link they had already spent. Nothing
     * in the response says which happened, so the assertion is on the request.
     */
    expect(auth.verifyEmailAskedForCookies).toBe(true);
  });

  it("strikes the credential out of the address", async () => {
    /*
     * A single-use credential must not sit in the address bar, in the session
     * history or in whatever a screen-share is showing — and a *refused*
     * consumption deliberately spends nothing (ADR-0071 §1), so a link that
     * failed for a reason other than the token stays live for the rest of its
     * day while the address still holds it. `replace`, so Back cannot walk to
     * the entry that carried it.
     *
     * Asserted on the refused path rather than the successful one: success
     * navigates away, which would strike the fragment whether the effect did
     * or not, and the window this property protects is the one that stays open.
     */
    const { router } = setup(link("a-dead-link"));

    expect(
      await screen.findByText(/This link cannot be used/),
    ).toBeInTheDocument();

    expect(router.state.location.hash).toBe("");
    expect(router.state.location.pathname).toBe("/verify-email");
    expect(router.history.length).toBe(1);
  });

  it("says so, and starts nothing, when the link is refused", async () => {
    const { store } = setup(link("a-dead-link"));

    expect(
      await screen.findByText(/This link cannot be used/),
    ).toBeInTheDocument();

    expect(auth.verifyEmailCalls).toEqual(["a-dead-link"]);
    expect(store.isAuthenticated()).toBe(false);
    /*
     * One indistinguishable `401` for every cause (ADR-0071 §3), so there is
     * one sentence and no branch — and the way forward is the resend control,
     * which is why it is drawn on this state too.
     */
    expect(
      screen.getByRole("button", { name: "Send a new link" }),
    ).toBeInTheDocument();
  });

  it("asks for nothing at all when the address carries no link", async () => {
    setup("/verify-email");

    /*
     * The ordinary landing after signing up, not a mishap — which is why this
     * state's copy is the check-your-mail sentence and its name is `awaiting`
     * rather than the handoff screen's `missing`.
     */
    expect(
      await screen.findByText(/Follow the link in your inbox/),
    ).toBeInTheDocument();

    // MSW runs with `onUnhandledRequest: "error"`, so a stray request would
    // have failed the render rather than this line.
    expect(auth.verifyEmailCalls).toEqual([]);
  });

  it("resends to whatever address is in the box, and says the same thing either way", async () => {
    const { user } = setup("/verify-email");
    const stranger = "nobody@machxi.local";

    await user.type(await screen.findByLabelText("Email"), stranger);
    await user.click(screen.getByRole("button", { name: "Send a new link" }));

    /*
     * The confirmation is worded about what was asked rather than about what
     * was found: the endpoint answers `202` for an address with an account
     * waiting and for a stranger's alike (ADR-0020 §Enumeration), so a
     * sentence that named the account would be a client-side oracle over an
     * enumeration-safe API.
     */
    expect(
      await screen.findByText(/a new link is on its way/),
    ).toBeInTheDocument();

    expect(auth.resendVerificationCalls).toEqual([
      { email: stranger, locale: "en" },
    ]);
  });

  it("shows the catalogue sentence when the limiter refuses the request", async () => {
    const { user } = setup("/verify-email");

    /*
     * The one answer that is about the caller rather than about the mailbox
     * (ADR-0071 §4's budget, shared with recovery in a counter of its own), so
     * the one refusal this control may render without becoming an oracle.
     */
    server.use(
      http.post(`${PUBLIC_API}/auth/resend-verification`, () =>
        fail(429, "RATE_LIMITED"),
      ),
    );

    await user.type(await screen.findByLabelText("Email"), "someone@x.test");
    await user.click(screen.getByRole("button", { name: "Send a new link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts. Wait a moment and try again.",
    );
    expect(screen.queryByText(/a new link is on its way/)).toBeNull();
  });

  it("does not spend the link in a browser that already holds a session", async () => {
    /*
     * ADR-0071 §3 as amended at `D18.4`, out of that step's
     * `security-reviewer`: a client that spends a fragment on mount is a
     * **forced-login primitive**, and this token's class is not ADR-0057 §2's.
     * Anybody can mint one by registering an address they control, and it lives
     * a day — so an attacker can hold a live link and get a signed-in person to
     * open it, on this app's own origin, and that person then works inside the
     * attacker's account. The gate is that the exchange waits for a click.
     */
    const { user, store } = {
      user: userEvent.setup(),
      ...renderApp({
        initialPath: link(VERIFICATION_TOKEN),
        store: authenticated({ email: "resident@machxi.local" }),
      }),
    };

    expect(
      await screen.findByText(/You are already signed in/),
    ).toBeInTheDocument();

    // Nothing posted, and the session that was here is untouched.
    expect(auth.verifyEmailCalls).toEqual([]);
    expect(store.getPrincipal()?.email).toBe("resident@machxi.local");

    /*
     * And no resend control on this state: the link is right there, held, and
     * a resend would supersede it (ADR-0071 §1).
     */
    expect(screen.queryByRole("textbox")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Confirm and switch account" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Your account" }),
    ).toBeInTheDocument();
    expect(auth.verifyEmailCalls).toEqual([VERIFICATION_TOKEN]);
    expect(store.getPrincipal()?.email).toBe(PRINCIPAL.email);
  });

  it("strikes the credential out of the address before it waits for that click", async () => {
    /*
     * The held branch strikes the fragment **first**, so a link waiting for a
     * click is not also sitting in the address bar — which is the exposure the
     * strike exists to close, and the one that would otherwise be widest here
     * because this branch is the one a person sits on longest.
     */
    const { router } = {
      ...renderApp({
        initialPath: link(VERIFICATION_TOKEN),
        store: authenticated(),
      }),
    };

    expect(
      await screen.findByText(/You are already signed in/),
    ).toBeInTheDocument();

    expect(router.state.location.hash).toBe("");
    expect(router.history.length).toBe(1);
  });

  it("leaves nothing unaccented on the states a person sits on", async () => {
    /*
     * ADR-0046 §14's walk reaches `/verify-email` — it is a leaf of the
     * generated tree — but only ever in its `awaiting` state, so `verify.refused`
     * and the resend control's outcome are copy the lens would otherwise never
     * see (the finding `D13.7` made about the exchange screen's twin). Under
     * the lens every translated string is bracketed and accented, so an English
     * sentence hardcoded here would be the only readable thing on the screen.
     */
    const user = userEvent.setup();

    renderApp({
      initialPath: link("a-dead-link"),
      store: createSessionStore(),
      pseudo: true,
    });

    /*
     * Waited on the **render** rather than on the request (`D18.4`'s
     * `code-reviewer`). `verifyEmailCalls` is pushed when MSW *receives* the
     * post, several ticks before the rejection reaches the hook — and until it
     * does the screen is in `pending`, which draws no resend control at all.
     * Gating on the request would have let the assertion below pass vacuously,
     * over a sentence that was never rendered, and then thrown on the control
     * that was not there either. The box only exists once `refused` has
     * rendered, so finding it is both the wait and the proof.
     */
    const box = await screen.findByRole("textbox");

    expect(document.body.textContent ?? "").not.toContain(
      "This link cannot be used",
    );

    await user.type(box, "someone@machxi.local");
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(auth.resendVerificationCalls).toHaveLength(1);
    });

    expect(screen.getByRole("status").textContent ?? "").toContain("[");
    expect(document.body.textContent ?? "").not.toContain(
      "a new link is on its way",
    );
  });
});
