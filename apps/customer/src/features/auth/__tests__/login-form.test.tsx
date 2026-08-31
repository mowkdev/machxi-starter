import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { describe, expect, it } from "vitest";

import {
  API,
  CREDENTIALS,
  createAuthHandlers,
  createAuthMockState,
} from "@/test/msw/handlers/auth.handlers";
import { fail } from "@/test/msw/handlers/envelope";
import { server } from "@/test/msw/server";
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
  server.use(...createAuthHandlers(createAuthMockState()));

  return {
    user: userEvent.setup(),
    ...renderApp({ initialPath: path }),
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

  it("degrades to one written sentence for a code it has never heard of", async () => {
    const { user } = setup();

    server.use(
      http.post(`${API}/auth/login`, () =>
        /*
         * An older bundle meeting a newer API. The cast is the test saying "a
         * code this build does not know" — exactly the state the type system
         * cannot express, because the union *is* this build's.
         *
         * **What it degrades to is a finding, and the assertion pins it rather
         * than wishing.** ADR-0013 tells clients to degrade on an unrecognised
         * code, and `createMessageForError`'s `defaultValue` is this app's
         * half of that. It is unreachable from the wire: `@repo/api-client`
         * parses the body with `errorEnvelopeSchema`, whose `code` is
         * `z.enum(ERROR_CODES)` — so an unknown code fails the parse, the
         * whole response stops being an envelope, and the client normalises it
         * to `TRANSPORT_ERROR_CODE`. The customer is then told to check their
         * connection about a refusal the server delivered perfectly well.
         *
         * Recorded in `docs/plan/0012-customer-app.md` §Findings against
         * D8–D11 rather than fixed here: the fix is a `@repo/api-client` diff,
         * and this deliverable's rule is that a package diff is named before it
         * is made. This assertion is what makes that fix a visible change.
         */
        fail(409, "SOMETHING_NEW_FROM_THE_FUTURE" as "CONFLICT"),
      ),
    );

    await signIn(user);

    const alert = await screen.findByRole("alert");

    // A written sentence, whichever one — never the raw code on screen, which
    // is the outcome the catalogue exists to prevent.
    expect(alert).toHaveTextContent(
      "We could not reach the service. Check your connection and try again.",
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
