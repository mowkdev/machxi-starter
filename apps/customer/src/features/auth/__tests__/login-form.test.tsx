import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { afterEach, describe, expect, it } from "vitest";

import {
  API,
  CREDENTIALS,
  PRINCIPAL,
  createAuthHandlers,
  createAuthMockState,
} from "@/test/msw/handlers/auth.handlers";
import { fail, server } from "@repo/app-kit/testing";
import {
  TEAM_ORGANIZATION,
  createOrganizationsHandlers,
  createOrganizationsMockState,
} from "@/test/msw/handlers/organizations.handlers";
import { organizationStorageKey } from "@/entities/organization";
import { renderApp } from "@/test/render";

/**
 * The sign-in screen, driven the way a customer drives it (ADR-0036: query by
 * role and accessible name, act with `user-event`, assert what a user sees).
 *
 * It renders through the real route tree, so the `_auth` layout, the route's
 * `validateSearch` and the redirect after success are all exercised rather than
 * re-declared.
 */

const setup = ({ path = "/login" }: { path?: string } = {}) => {
  server.use(
    ...createAuthHandlers(createAuthMockState()),
    /*
     * The switcher reads `GET /user/orgs` from the shell's header (`D15.5`,
     * ADR-0067 §6), so every screen behind the guard makes this request —
     * including the ones this file is about, which never mention an
     * organization. Answered rather than left unhandled, because a suite whose
     * shell is half-failed is a suite certifying a screen nobody ships.
     */
    ...createOrganizationsHandlers(createOrganizationsMockState()),
  );

  return {
    user: userEvent.setup(),
    ...renderApp({ initialPath: path }),
  };
};

afterEach(() => {
  localStorage.clear();
});

/**
 * The device key the landing rule reads.
 *
 * `PRINCIPAL`'s id and not `userPrincipal()`'s: the landing reads the id off the
 * **response** rather than off a store fixture, and this file's two ids differ
 * by construction (see `auth.handlers`) — so keying this on the wrong one would
 * be a test that passed only if the rule ignored the principal entirely.
 */
const rememberedKey = organizationStorageKey(PRINCIPAL.id);

const signIn = async (
  user: ReturnType<typeof userEvent.setup>,
  email: string = CREDENTIALS.email,
  password: string = CREDENTIALS.password,
) => {
  await user.type(await screen.findByLabelText("Email"), email);
  await user.type(await screen.findByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
};

describe("sign in", () => {
  it("signs in and lands on the home screen", async () => {
    const { user, store } = setup();

    await signIn(user);

    expect(
      await screen.findByRole("heading", { name: "Your account" }),
    ).toBeInTheDocument();
    // The client hydrated the store, which is what the guard reads.
    expect(store.isAuthenticated()).toBe(true);
    expect(store.getPrincipal()?.email).toBe(CREDENTIALS.email);
    // And it hydrated it with a *customer*: the segment the client is pinned to
    // is the whole of what makes this the customer app on the wire
    // (ADR-0055 §2), and a principal of the other kind arriving here would mean
    // it is not.
    expect(store.getPrincipal()?.kind).toBe("user");
  });

  it("lands in the team this device last had this principal in", async () => {
    /*
     * **Where sign-in lands when the guard recorded no `redirect`** (`D15.9`,
     * ADR-0067 §6 as amended 2026-09-07) — the first of the remembered key's
     * exactly two consumers. A customer who works in one team should not have
     * to switch into it on every sign-in.
     */
    localStorage.setItem(rememberedKey, TEAM_ORGANIZATION.slug);

    const { router, user } = setup();

    await signIn(user);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/orgs/${TEAM_ORGANIZATION.slug}`,
      );
    });
  });

  it("lands on the private home when nothing is remembered", async () => {
    const { router, user } = setup();

    await signIn(user);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
  });

  it("lands on the private home when the remembered team is not a membership", async () => {
    /*
     * The case that cannot fix itself: the value is on the customer's own
     * device, so a team they have been removed from would send them to a
     * not-found on every sign-in forever. The landing rule checks the
     * remembered slug against the list rather than trusting it.
     */
    localStorage.setItem(rememberedKey, "left-this-one");

    const { router, user } = setup();

    await signIn(user);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
    expect(
      screen.queryByText("That address does not exist."),
    ).not.toBeInTheDocument();
  });

  it("spends the guard's redirect ahead of anything remembered", async () => {
    /*
     * A session that expired mid-task returns somebody to the screen they were
     * on, which is a stronger statement about where they wanted to be than
     * anything a device remembers — so the `redirect` branch wins outright and
     * the landing rule is never consulted.
     */
    localStorage.setItem(rememberedKey, TEAM_ORGANIZATION.slug);

    const { router, user } = setup({
      path: "/login?redirect=%2Faccount%2Fprofile",
    });

    await signIn(user);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/account/profile");
    });
  });

  it("returns the customer to the page the guard turned away", async () => {
    const { user } = setup({ path: "/login?redirect=%2F" });

    await signIn(user);

    // The round trip `_dashboard`'s guard starts: it records the attempted
    // location, the route validates it as same-origin, and this is where it
    // gets spent.
    expect(
      await screen.findByRole("heading", { name: "Your account" }),
    ).toBeInTheDocument();
  });

  it("refuses to spend an off-origin redirect", async () => {
    const { user, router } = setup({
      path: "/login?redirect=https%3A%2F%2Fevil.example",
    });

    await signIn(user);

    /*
     * `validateSearch`'s `.catch(undefined)` dropped the value before the form
     * ever saw it, so the fallback applies and the navigation is same-origin.
     * The assertion is on where the router actually is rather than on the
     * absence of an error, because "it did not crash" would also pass if the
     * value had been honoured.
     */
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
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

  it("renders a refusal through the code map, not the API's message", async () => {
    const { user, store } = setup();

    server.use(
      http.post(`${API}/auth/login`, () =>
        /*
         * A `message` a customer must never read: ADR-0013 makes it a
         * developer-facing English default, and rendering it would bypass the
         * i18n seam `shared/notifications/messages.ts` exists to be. The
         * assertion below is two-sided for exactly that reason — the sentence
         * from the `errors` catalogue is present, and this string is not.
         */
        fail(401, "AUTH_INVALID_CREDENTIALS", "argon2 verify returned false"),
      ),
    );

    await signIn(user, CREDENTIALS.email, "WrongPassword!123");

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent(
      "That email and password do not match an account.",
    );
    expect(document.body.textContent).not.toContain("argon2");
    expect(store.isAuthenticated()).toBe(false);
    // Still on the sign-in screen: a failed sign-in navigates nowhere.
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("offers the confirmation screen when the address has not been proven", async () => {
    /*
     * `403 AUTH_EMAIL_UNVERIFIED` (`D18.4`, ADR-0071 §3) — the one refusal on
     * this screen with a way forward, and the only one that gets an
     * affordance. The code is deliberately distinguishable from
     * `AUTH_INVALID_CREDENTIALS`: the password has already been proven, so
     * ADR-0020 §Enumeration has nothing left to protect, and a client that
     * could not tell them apart would have to offer the resend to everybody
     * who mistypes a password.
     */
    const { user, store, router } = setup();

    server.use(
      http.post(`${API}/auth/login`, () => fail(403, "AUTH_EMAIL_UNVERIFIED")),
    );

    await signIn(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Confirm your email address before signing in.",
    );
    expect(store.isAuthenticated()).toBe(false);

    await user.click(
      screen.getByRole("link", { name: "Send the confirmation link again" }),
    );

    expect(router.state.location.pathname).toBe("/verify-email");
    /*
     * And the address travels with it as history state, so the resend control
     * starts filled in with what was just typed rather than asking a second
     * time. Read off the rendered field, because history state is not in the
     * URL — which is the whole reason it was chosen.
     */
    expect(await screen.findByLabelText("Email")).toHaveValue(
      CREDENTIALS.email,
    );
  });

  it("offers that way out only for that one refusal", async () => {
    const { user } = setup();

    server.use(
      http.post(`${API}/auth/login`, () =>
        fail(401, "AUTH_INVALID_CREDENTIALS"),
      ),
    );

    await signIn(user, CREDENTIALS.email, "WrongPassword!123");

    await screen.findByRole("alert");

    // A wrong password is not an unproven address, and offering to mail a
    // confirmation link over one would say something about the account that
    // ADR-0020 §Enumeration refuses to say.
    expect(
      screen.queryByRole("link", { name: "Send the confirmation link again" }),
    ).toBeNull();
  });

  it("degrades to one written sentence for a code it has never heard of", async () => {
    const { user } = setup();

    server.use(
      http.post(`${API}/auth/login`, () =>
        /*
         * An older bundle meeting a newer API. The cast is the test saying "a
         * code this build does not know" — exactly the state the type system
         * cannot express, because the union *is* this build's.
         *
         * **The sentence changed at `D13.1`, and that is the point.** D12
         * recorded the finding here (`docs/plan/0012-customer-app.md`
         * §Findings against D8–D11) and pinned what the app actually did:
         * `errorEnvelopeSchema`'s `code` was a closed enum, so an unknown code
         * failed the parse, the response stopped being an envelope, and the
         * client normalised it to `TRANSPORT_ERROR_CODE` — the customer was
         * told to check a connection that was fine. Since the widening the
         * client degrades by status instead (ADR-0057 §Consequences), so a
         * `409` this build cannot name reads as the conflict family it is.
         */
        fail(409, "SOMETHING_NEW_FROM_THE_FUTURE" as "CONFLICT"),
      ),
    );

    await signIn(user);

    const alert = await screen.findByRole("alert");

    // A written sentence — never the raw code on screen, which is the outcome
    // the catalogue exists to prevent — and now the right family of sentence.
    expect(alert).toHaveTextContent(
      "That conflicts with something that already exists.",
    );
    expect(alert.textContent).not.toContain("SOMETHING_NEW");
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

    // The rule ADR-0035's machinery enforces for every config-driven form,
    // honoured here by hand: nothing is editable and nothing is re-submittable
    // until the request settles, success or failure.
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
