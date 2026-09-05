import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { createAppRouter } from "@/app/providers/router";
import {
  createAuthHandlers,
  createAuthMockState,
  type AuthMockState,
} from "@/test/msw/handlers/auth.handlers";
import {
  createProfileHandlers,
  createProfileMockState,
} from "@/test/msw/handlers/profile.handlers";
import {
  createOrganizationsHandlers,
  createOrganizationsMockState,
} from "@/test/msw/handlers/organizations.handlers";
import { server } from "@repo/app-kit/testing";
import { authenticated, impersonated, impersonator } from "@/test/principals";
import { renderApp } from "@/test/render";

/**
 * The banner that names both identities (`D13.7`; ADR-0057 §4, §6, §7,
 * ADR-0048 §3 as carried).
 *
 * Driven through the real route tree rather than by rendering the widget,
 * because two of the three claims are about *where* it appears: on every
 * screen behind the guard, on none of them for an ordinary session, and with
 * an exit that ends the session and lands somewhere signed out. A component
 * render could only have asserted the middle of the sentence.
 */

const OPERATOR = impersonator().email;

/**
 * Every address behind the `_dashboard` guard, from the router the app builds.
 *
 * **Read off the tree rather than listed**, for the reason the pseudo-locale
 * walk gives: a screen added later is covered on arrival instead of when
 * somebody remembers this file. The filter is on the route *id* rather than on
 * the path, because a path cannot say which layout it inherited — `/login` and
 * `/impersonate` are leaves too, and neither is behind this guard.
 */
const DASHBOARD_PATHS: readonly string[] = [
  ...new Set(
    Object.entries(createAppRouter().routesById)
      .filter(([id]) => id.startsWith("/_dashboard/"))
      .map(([, route]) => String(route.fullPath)),
  ),
]
  .filter((path) => !path.includes("$"))
  .sort();

let auth: AuthMockState;

beforeEach(() => {
  auth = createAuthMockState();
  server.use(
    ...createAuthHandlers(auth),
    ...createProfileHandlers(createProfileMockState()),
    /*
     * The switcher reads `GET /user/orgs` from the shell's header (`D15.5`,
     * ADR-0067 §6), so every screen behind the guard makes this request —
     * including the ones this file is about, which never mention an
     * organization. Answered rather than left unhandled, because a suite whose
     * shell is half-failed is a suite certifying a screen nobody ships.
     */
    ...createOrganizationsHandlers(createOrganizationsMockState()),
  );
});

describe("the impersonation banner", () => {
  it("covers every screen behind the guard", () => {
    // A floor rather than an equality, so a route added by a later step joins
    // the walk without editing this line — and non-trivial, so a change that
    // silently emptied the list fails instead of passing vacuously.
    expect(DASHBOARD_PATHS.length).toBeGreaterThanOrEqual(2);
    expect(DASHBOARD_PATHS).toContain("/");
    expect(DASHBOARD_PATHS).toContain("/account/preferences");
  });

  it.each(DASHBOARD_PATHS)("names both identities at %s", async (path) => {
    const store = impersonated();

    renderApp({ initialPath: path, store });

    const banner = await screen.findByRole("status");

    /*
     * Both names, because either one alone is a sentence that misleads: the
     * customer's alone reads as an ordinary session, and the operator's alone
     * does not say whose account this is.
     */
    expect(banner).toHaveTextContent(String(store.getPrincipal()?.email));
    expect(banner).toHaveTextContent(OPERATOR);
    /*
     * The variant ADR-0048 §3 reserved for this consumer by name, and the
     * absence of a dismiss control: `Banner` defaults `dismissible` to `false`
     * precisely so a warning whose whole job is to stay cannot be waved away
     * (amended `D8.2`).
     */
    expect(banner).toHaveAttribute("data-variant", "warning");
    expect(
      screen.queryByRole("button", { name: "Dismiss" }),
    ).not.toBeInTheDocument();
  });

  it("draws no banner region at all for an ordinary session", async () => {
    const { container } = renderApp({ store: authenticated() });

    // Waited for, so the assertion is about a settled screen rather than about
    // one frame of an empty shell.
    await screen.findByRole("main");

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    /*
     * The region itself, not merely the notice. ADR-0048 §3's rule is that the
     * shell renders *nothing* when the slot is empty — an element that
     * reserved space would shift every page's height budget — and the only way
     * to see the difference is to ask for the region.
     */
    expect(
      container.querySelector('[data-slot="banner-region"]'),
    ).not.toBeInTheDocument();
  });

  it("stacks under the pseudo-locale notice rather than replacing it", async () => {
    /*
     * The only rendering decision `_dashboard.tsx` grew at `D13.7`, and until
     * this case nothing exercised it (`adr-reviewer`): every other test fills
     * exactly one notice. Both sentences are wanted at once — one says the
     * *build* is a translation build, the other says the *session* is somebody
     * else's — and suppressing either to tidy the region would hide a warning.
     */
    const { container } = renderApp({
      store: impersonated(),
      pseudoNotice: true,
    });

    const region = await waitFor(() => {
      const found = container.querySelector('[data-slot="banner-region"]');

      expect(found).not.toBeNull();

      return found as HTMLElement;
    });

    expect(within(region).getAllByRole("status")).toHaveLength(2);
    // The way out first: the region reads top to bottom and the impersonation
    // warning is the one a person has to act on.
    expect(within(region).getAllByRole("status")[0]).toHaveAttribute(
      "data-variant",
      "warning",
    );
  });

  it("survives the pseudo-locale lens, copy and all", async () => {
    /*
     * ADR-0046 §14's walk cannot reach this copy: `pseudo-locale.test.tsx`
     * visits every route under an *ordinary* session, so the banner is
     * structurally absent from it and `banner.message` / `banner.exit` would
     * be the first operator-facing strings in this app that no lens ever saw
     * (`adr-reviewer`). The lens is brought here instead, where the session
     * that shows them can be scripted.
     *
     * The assertion is the walk's: every translated string comes back
     * bracketed and accented, so a hardcoded English sentence is the only
     * readable thing left. The interpolated identities are accented with it —
     * `postProcess` runs after interpolation — which is why this asserts on
     * the region as a whole rather than allow-listing the two addresses.
     */
    renderApp({ store: impersonated(), pseudo: true });

    const banner = await screen.findByRole("status");

    expect(banner.textContent ?? "").toContain("[");
    expect(banner.textContent ?? "").toContain("]");
    expect(banner.textContent ?? "").not.toContain("Everything you do here");
    expect(within(banner).getByRole("button").textContent ?? "").toContain("[");
  });

  it("exits through the ordinary logout and lands signed out", async () => {
    const user = userEvent.setup();
    const store = impersonated();

    renderApp({ store });

    await user.click(
      await screen.findByRole("button", { name: "Leave this account" }),
    );

    /*
     * `POST /user/auth/logout` and not `logout-all`: ADR-0057 §5 keeps the
     * first off the exclusion list because it *is* the exit, and puts the
     * second on it because it would end the customer's own sessions. The
     * service sees the actor column and revokes with `impersonation_ended`,
     * which is the API's half and the integration tier's to assert.
     */
    await waitFor(() => {
      expect(auth.logoutCalls).toBe(1);
    });

    // The signed-out screen, reached through the guard rather than asserted
    // as a URL: what an operator has to end up looking at is a page they can
    // sign in from.
    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(store.isAuthenticated()).toBe(false);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
