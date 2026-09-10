import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import {
  CREDENTIALS,
  PUBLIC_API,
  createAuthHandlers,
  createAuthMockState,
  type AuthMockState,
} from "@/test/msw/handlers/auth.handlers";
import { fail } from "@/test/msw/handlers/envelope";
import {
  createOrganizationsHandlers,
  createOrganizationsMockState,
} from "@/test/msw/handlers/organizations.handlers";
import { server } from "@repo/app-kit/testing";
import { createSessionStore } from "@/shared/api/session-store";
import { renderApp } from "@/test/render";

/**
 * Self-service registration (`D15.6`, ADR-0067 §6 — the deferral ADR-0055 §5
 * left open, closed because sign-up is what creates the personal
 * organization).
 *
 * Driven through the real route tree from `/register`, so the `_auth` layout,
 * the route's own guard and the landing after success are exercised rather
 * than re-declared — the sign-in suite's shape, for a screen that is the
 * sign-in screen's twin.
 */

const NEW_ADDRESS = "nina@machxi.local";
const GOOD_PASSWORD = "DevPassword!123";

let state: AuthMockState;

beforeEach(() => {
  state = createAuthMockState();

  server.use(
    ...createAuthHandlers(state),
    /*
     * The switcher reads `GET /user/orgs` from the shell's header (`D15.5`),
     * so the screen this form lands on makes the request — and this suite's
     * whole point is what is *in* that switcher afterwards.
     */
    ...createOrganizationsHandlers(createOrganizationsMockState()),
  );
});

const setup = ({ path = "/register" }: { path?: string } = {}) => ({
  user: userEvent.setup(),
  // An empty store: `_auth`'s mirror guard sends a signed-in visitor home, so
  // a session here would render the home screen and assert nothing.
  ...renderApp({ initialPath: path, store: createSessionStore() }),
});

const registerAs = async (
  user: ReturnType<typeof userEvent.setup>,
  {
    email = NEW_ADDRESS,
    password = GOOD_PASSWORD,
    firstName,
    lastName,
  }: {
    email?: string;
    password?: string;
    firstName?: string;
    lastName?: string;
  } = {},
) => {
  await user.type(await screen.findByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Password"), password);

  if (firstName !== undefined)
    await user.type(screen.getByLabelText("First name"), firstName);

  if (lastName !== undefined)
    await user.type(screen.getByLabelText("Last name"), lastName);

  await user.click(screen.getByRole("button", { name: "Create account" }));
};

describe("registration", () => {
  it("creates the account and issues no session", async () => {
    /*
     * ADR-0071 §3's whole delta on the client: registration answers `202` and
     * starts nothing, because an address nobody has proven is not an account
     * anybody may be signed into. What signs a device in is the confirmation
     * link.
     *
     * **The store staying empty is the assertion.** The client used to hydrate
     * it from registration's body; hydrating from a `202` would write
     * `undefined` where the access token and the principal go, which is not
     * "no session" but a broken one — a shape the boot sequence has no branch
     * for, on a client that would then believe it was signed in.
     *
     * Where the form *lands* is not asserted here, and deliberately: today it
     * navigates home and the dashboard guard turns it straight back to the
     * sign-in screen, which is honest but not the screen a person should meet.
     * The check-your-mail screen and its resend are the step that builds them.
     */
    const { user, store } = setup();

    await registerAs(user, { firstName: "Nina", lastName: "Newcomer" });

    await waitFor(() => {
      expect(state.registerCalls).toHaveLength(1);
    });

    expect(store.isAuthenticated()).toBe(false);
    expect(store.getPrincipal()).toBeNull();
  });

  it("omits the names it was not given, and asks for no transport", async () => {
    const { user } = setup();

    await registerAs(user);

    await waitFor(() => {
      expect(state.registerCalls).toHaveLength(1);
    });

    /*
     * `registerBody`'s names are `nameSchema.optional()` — `min(1)` when
     * present — so an untouched box has to leave the body altogether rather
     * than travel as `""`, which the API would refuse for a field the customer
     * never filled in.
     */
    expect(state.registerCalls).toEqual([
      { email: NEW_ADDRESS, password: GOOD_PASSWORD },
    ]);

    /*
     * `X-Auth-Transport: cookie` moved off this call with the session
     * (ADR-0071 §3, ADR-0029 §Opt-in). The header exists to put a refresh
     * token in a cookie instead of in the body, and there is now no token in
     * either — so sending it would be a header asking for something the
     * endpoint cannot do, and one more preflight for an app served from a
     * different host than the API.
     */
    expect(state.registerAskedForCookies).toBe(false);
  });

  it("renders the catalogue's conflict sentence for an address that is taken", async () => {
    const { user, store } = setup();

    // The seeded customer's address, which `createAuthMockState` starts as
    // taken — the API answers the generic `409 CONFLICT` rather than
    // `USER_EMAIL_TAKEN`, because a code that named the collision would
    // confirm the address has an account (ADR-0020 §Enumeration).
    await registerAs(user, { email: CREDENTIALS.email });

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent(
      "That conflicts with something that already exists.",
    );
    expect(store.isAuthenticated()).toBe(false);
    // Still on the sign-up screen: a refused registration navigates nowhere.
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("refuses a body the API would refuse, before sending anything", async () => {
    const { user, store } = setup();

    await registerAs(user, { email: "not-an-email", password: "short" });

    /*
     * `registerBody` is the object the API validates with (ADR-0011/0023), so
     * a field the server would reject is one the client never sends. The
     * sentence is zod's own rather than a key this app wrote — which is
     * ADR-0046 §6's shape, and is why the assertion is on the text.
     *
     * It does **not** prove the error map is *installed*, and the case below
     * is what does: under `en` `applyZodLocale` installs zod's own English
     * map, which is the one zod would have used anyway, so this string
     * survives the installer being deleted. Found by `code-reviewer`, which
     * read the claim this comment used to make.
     */
    expect(
      await screen.findByText(/expected string to have >=12 characters/i),
    ).toBeInTheDocument();

    expect(state.registerCalls).toEqual([]);
    expect(store.isAuthenticated()).toBe(false);
  });

  it("takes its field rules from the client-side error map, in the reader's language", async () => {
    const user = userEvent.setup();

    renderApp({
      initialPath: "/register",
      store: createSessionStore(),
      locale: "lv",
    });

    /*
     * Awaiting a Latvian label first is what makes the assertion below safe
     * rather than racy: `createI18n` holds the `languageChanged` announcement
     * until the zod installer has landed (`app-i18n.ts`'s
     * `localeSideEffectsReady`), so copy in Latvian on screen means the map
     * for Latvian is in `z.config`.
     */
    await user.type(await screen.findByLabelText("Parole"), "short");
    await user.click(screen.getByRole("button", { name: "Izveidot kontu" }));

    /*
     * `Pārāk mazs` is `@repo/contracts/locales/lv`'s `too_small`, reachable
     * only through `applyZodLocale` — zod ships no Latvian, so deleting the
     * installer answers this in English and fails here. That is the half the
     * English case above cannot assert (ADR-0046 §6).
     */
    expect(await screen.findByText(/Pārāk mazs/)).toBeInTheDocument();
    expect(state.registerCalls).toEqual([]);
  });

  it("says the address does not exist when the API has the feature off", async () => {
    const { user, store } = setup();

    /*
     * The one combination the two flags allow to disagree: this build offers
     * the screen and the API does not mount the endpoint, so the path answers
     * `404 ROUTE_NOT_FOUND` rather than a `403` that would confirm the feature
     * (ADR-0004). The client has no branch for it — the `errors` catalogue
     * turns the code into a sentence, which is exactly what "the API's flag is
     * the control" costs the client.
     */
    server.use(
      http.post(`${PUBLIC_API}/auth/register`, () =>
        fail(404, "ROUTE_NOT_FOUND"),
      ),
    );

    await registerAs(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That address does not exist.",
    );
    expect(store.isAuthenticated()).toBe(false);
  });

  it("disables every field while the request is in flight", async () => {
    const { user } = setup();
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    server.use(
      http.post(`${PUBLIC_API}/auth/register`, async () => {
        await held;
        return fail(409, "CONFLICT");
      }),
    );

    await registerAs(user);

    // ADR-0035's rule for every config-driven form, honoured here by hand:
    // nothing editable and nothing re-submittable until the request settles.
    await waitFor(() => {
      expect(screen.getByLabelText("Email")).toBeDisabled();
    });
    expect(screen.getByLabelText("Password")).toBeDisabled();
    expect(screen.getByLabelText("First name")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /creating your account/i }),
    ).toBeDisabled();

    release?.();

    await waitFor(() => {
      expect(screen.getByLabelText("Email")).toBeEnabled();
    });
  });
});
