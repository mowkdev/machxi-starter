import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import {
  GOOGLE_HANDOFF_TOKEN,
  PRINCIPAL,
  PUBLIC_API,
  authResource,
  createAuthHandlers,
  createAuthMockState,
  type AuthMockState,
} from "@/test/msw/handlers/auth.handlers";
import { ok, server } from "@repo/app-kit/testing";
import {
  bothWaysProfile,
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
 * `/auth/google` — where Google's callback hands a person back (`D19.3`,
 * ADR-0072 §2, §4).
 *
 * Driven through the generated route tree on a memory history, as
 * `/verify-email`'s suite is and for its reason: the credential arrives in the
 * URL **fragment**, and `renderApp` hands `initialPath` to
 * `createMemoryHistory` so `#token=…` reaches the router the way a browser
 * delivers it. The callback's three fragments are the three describes below.
 */

const landing = (fragment: Record<string, string>) =>
  `/auth/google#${new URLSearchParams(fragment).toString()}`;

let auth: AuthMockState;

beforeEach(() => {
  auth = createAuthMockState();
  server.use(
    ...createAuthHandlers(auth),
    // The screens this lands on read the profile and the organizations.
    ...createProfileHandlers(createProfileMockState()),
    ...createOrganizationsHandlers(createOrganizationsMockState()),
  );
});

describe("a sign-in to finish", () => {
  it("strikes the fragment before the handoff is exchanged", async () => {
    /*
     * Read from inside the exchange's own handler, so what is asserted is the
     * address at the moment the credential left — not the address after a
     * successful exchange navigated away, which would be clean whether the
     * strike ran or not. The handler reads `rendered` through its closure,
     * and it runs only once the request has left — after the assignment.
     */
    const atExchange: { hash?: string; entries?: number } = {};

    server.use(
      http.post(`${PUBLIC_API}/auth/google/exchange`, () => {
        atExchange.hash = rendered.router.state.location.hash;
        atExchange.entries = rendered.router.history.length;

        return ok(authResource("access-google"));
      }),
    );

    const rendered = renderApp({
      initialPath: landing({ token: GOOGLE_HANDOFF_TOKEN }),
      store: createSessionStore(),
    });

    expect(
      await screen.findByRole("heading", { name: "Your account" }),
    ).toBeInTheDocument();

    expect(atExchange.hash).toBe("");
    // `replace`, so Back cannot walk to the entry that carried it.
    expect(atExchange.entries).toBe(1);
  });

  it("exchanges once, with the browser's cookies on cookie transport, and lands home", async () => {
    const { router, store } = renderApp({
      initialPath: landing({ token: GOOGLE_HANDOFF_TOKEN }),
      store: createSessionStore(),
      // `StrictMode` double-invokes the effect; the latch is what keeps one
      // arrival to one exchange, and without it this case would not see one.
      strict: true,
    });

    expect(
      await screen.findByRole("heading", { name: "Your account" }),
    ).toBeInTheDocument();

    expect(auth.googleExchangeCalls).toEqual([GOOGLE_HANDOFF_TOKEN]);
    /*
     * The handoff is bound to the browser the callback answered (ADR-0072 §2
     * as amended at `D19.2`): the binding is a cookie on the API's origin, so
     * an exchange without credentials carries none, and the real endpoint —
     * and this mock — answer every such sign-in `401`.
     */
    expect(auth.googleExchangeCarriedCredentials).toBe(true);
    // Without the header the session dies on the first reload (ADR-0029).
    expect(auth.googleExchangeAskedForCookies).toBe(true);

    expect(router.state.location.pathname).toBe("/");
    expect(store.isAuthenticated()).toBe(true);
    expect(store.getPrincipal()?.email).toBe(PRINCIPAL.email);
  });

  it("asks first in a browser that already holds a session", async () => {
    /*
     * ADR-0071 §3's `D18.4` rule, which ADR-0072 §2 inherits whole: a client
     * that spends a fragment on mount is a forced-login primitive. The handoff
     * waits for a click — and the fragment is struck while it waits.
     */
    const user = userEvent.setup();
    const { router, store } = renderApp({
      initialPath: landing({ token: GOOGLE_HANDOFF_TOKEN }),
      store: authenticated({ email: "resident@machxi.local" }),
    });

    expect(
      await screen.findByText(/You are already signed in/),
    ).toBeInTheDocument();

    expect(auth.googleExchangeCalls).toEqual([]);
    expect(store.getPrincipal()?.email).toBe("resident@machxi.local");
    expect(router.state.location.hash).toBe("");
    expect(router.history.length).toBe(1);

    await user.click(
      screen.getByRole("button", { name: "Continue and switch account" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Your account" }),
    ).toBeInTheDocument();
    expect(auth.googleExchangeCalls).toEqual([GOOGLE_HANDOFF_TOKEN]);
    expect(store.getPrincipal()?.email).toBe(PRINCIPAL.email);
  });

  it("says so, with the way back to sign in, when the exchange is refused", async () => {
    const { router, store } = renderApp({
      initialPath: landing({ token: "a-spent-handoff" }),
      store: createSessionStore(),
    });

    expect(
      await screen.findByText(/That sign-in did not work/),
    ).toBeInTheDocument();

    expect(auth.googleExchangeCalls).toEqual(["a-spent-handoff"]);
    expect(store.isAuthenticated()).toBe(false);
    expect(router.state.location.hash).toBe("");
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("leaves nothing unaccented while it asks", async () => {
    /*
     * ADR-0046 §14's walk reaches `/auth/google` with nothing in the fragment,
     * so the question and its button are copy the lens would otherwise never
     * see (the finding `D13.7` made about `/impersonate`).
     */
    renderApp({
      initialPath: landing({ token: GOOGLE_HANDOFF_TOKEN }),
      store: authenticated(),
      pseudo: true,
    });

    const button = await screen.findByRole("button");

    expect(button.textContent ?? "").toContain("[");
    expect(document.body.textContent ?? "").not.toContain(
      "You are already signed in",
    );
  });
});

describe("a link to finish", () => {
  it("lands on the security section, carrying which provider was linked", async () => {
    const { router } = renderApp({
      initialPath: landing({ linked: "google" }),
      store: authenticated(),
    });

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/account/security");
    });

    // The fragment is gone with the entry that carried it.
    expect(router.state.location.hash).toBe("");
    expect(router.history.length).toBe(1);
    // History state, for the section's notice (`D19.5`) — not a location.
    expect(router.state.location.state.identityLinked).toEqual({
      provider: "google",
    });
    expect(auth.googleExchangeCalls).toEqual([]);
  });

  it("shows the notice there when the server lists the provider", async () => {
    server.use(
      ...createProfileHandlers(createProfileMockState(bothWaysProfile())),
    );

    renderApp({
      initialPath: landing({ linked: "google" }),
      store: authenticated(),
    });

    expect(
      await screen.findByText(
        "Google is linked. You can sign in with it from now on.",
      ),
    ).toBeInTheDocument();
  });

  it("draws no notice when the server does not list the provider, whatever the fragment said", async () => {
    /*
     * ADR-0072 §4, amended after `D19.3`: `#linked=google` can be planted —
     * anybody can send a signed-in person to that address — and the history
     * state it becomes is a hint. The server's list is the fact, and here it
     * is empty.
     */
    renderApp({
      initialPath: landing({ linked: "google" }),
      store: authenticated(),
    });

    // The section has arrived once its card shows the account's methods.
    expect(
      await screen.findByRole("button", { name: "Change password" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Google is linked/)).toBeNull();
  });
});

describe("a link the callback refused", () => {
  it("goes back to the security section with the code's sentence as a notice", async () => {
    /*
     * ADR-0072 §4, amended after `D19.3`: a signed-in browser reaches the
     * callback only from the link start, so a refusal there is a link that
     * did not happen — and "sign in again" is the wrong sentence for somebody
     * who is signed in.
     */
    const { router } = renderApp({
      initialPath: landing({ error: "AUTH_IDENTITY_TAKEN" }),
      store: authenticated(),
    });

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/account/security");
    });

    expect(
      await screen.findByText(
        "That Google account is already linked to another account here. Unlink it there first, or choose a different Google account.",
      ),
    ).toBeInTheDocument();
    expect(router.state.location.hash).toBe("");
    expect(router.history.length).toBe(1);
    expect(screen.queryByRole("link", { name: "Go to sign in" })).toBeNull();
  });

  it("reads the link's UNAUTHENTICATED as an attempt that did not finish", async () => {
    renderApp({
      initialPath: landing({ error: "UNAUTHENTICATED" }),
      store: authenticated(),
    });

    expect(
      await screen.findByText(/Linking Google did not finish/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Your session has ended/)).toBeNull();
  });
});

describe("a refusal from the callback", () => {
  it("renders the catalogue's sentence for the code, with a link to sign in", async () => {
    const { router } = renderApp({
      initialPath: landing({ error: "AUTH_FEDERATED_SIGNUP_CLOSED" }),
      store: createSessionStore(),
    });

    expect(
      await screen.findByText(
        "New accounts cannot be created here right now. If you already have an account, sign in with your email and password.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute(
      "href",
      "/login",
    );

    expect(router.state.location.hash).toBe("");
    // MSW runs with `onUnhandledRequest: "error"`, and nothing was posted.
    expect(auth.googleExchangeCalls).toEqual([]);
  });

  it("reads the callback's UNAUTHENTICATED as a sign-in that did not work, not a session that ended", async () => {
    /*
     * ADR-0072 §2 as amended at `D19.2`: a callback this browser did not
     * start, a declined consent and a refused code all answer the generic
     * `UNAUTHENTICATED` — "that sign-in did not work, try again". The
     * catalogue's sentence for that code is about a session having ended,
     * which is not what happened to somebody who never had one.
     */
    renderApp({
      initialPath: landing({ error: "UNAUTHENTICATED" }),
      store: createSessionStore(),
    });

    expect(
      await screen.findByText(/That sign-in did not work/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Your session has ended/)).toBeNull();
  });

  it("degrades to one written sentence for a code this build has never heard of", async () => {
    renderApp({
      initialPath: landing({ error: "AUTH_SOMETHING_FROM_A_NEWER_API" }),
      store: createSessionStore(),
    });

    expect(
      await screen.findByText("Something went wrong. Try again."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/AUTH_SOMETHING/)).toBeNull();
  });
});

describe("an arrival with nothing to finish", () => {
  it("says so and asks for nothing", async () => {
    renderApp({ initialPath: "/auth/google", store: createSessionStore() });

    expect(
      await screen.findByText(/There is nothing to finish here/),
    ).toBeInTheDocument();
    expect(auth.googleExchangeCalls).toEqual([]);
  });

  it("spends nothing that arrives after it, in a browser holding a session", async () => {
    /*
     * `D19.3`'s `security-reviewer`: a tab sitting here with nothing to
     * finish, whose address then gains `#token=…` without a reload — pasted,
     * or set by the page that opened it — is a same-document navigation that
     * keeps this screen mounted. Acting on it would spend the handoff with the
     * ask-first decision taken for the *first* address, which had no token.
     * One mount acts on the arrival it read, and on nothing after it.
     */
    const { router, store } = renderApp({
      initialPath: "/auth/google",
      store: authenticated({ email: "resident@machxi.local" }),
    });

    expect(
      await screen.findByText(/There is nothing to finish here/),
    ).toBeInTheDocument();

    await router.navigate({
      to: "/auth/google",
      hash: new URLSearchParams({ token: GOOGLE_HANDOFF_TOKEN }).toString(),
    });

    await waitFor(() => {
      expect(router.state.location.hash).not.toBe("");
    });
    // Let the effect see the new hash before asserting it did nothing with it.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(auth.googleExchangeCalls).toEqual([]);
    expect(store.getPrincipal()?.email).toBe("resident@machxi.local");
    expect(screen.getByText(/There is nothing to finish here/)).toBeVisible();
  });
});
