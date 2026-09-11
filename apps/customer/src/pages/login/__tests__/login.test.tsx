import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GOOGLE_AUTHORIZATION_URL,
  GOOGLE_HANDOFF_TOKEN,
  PUBLIC_API,
  createAuthHandlers,
  createAuthMockState,
  type AuthMockState,
} from "@/test/msw/handlers/auth.handlers";
import { fail, ok } from "@/test/msw/handlers/envelope";
import {
  createOrganizationsHandlers,
  createOrganizationsMockState,
} from "@/test/msw/handlers/organizations.handlers";
import {
  createProfileHandlers,
  createProfileMockState,
} from "@/test/msw/handlers/profile.handlers";
import { server } from "@repo/app-kit/testing";
import { createSessionStore } from "@/shared/api/session-store";
import type { AppFeatures } from "@/shared/config";
import { renderApp } from "@/test/render";

/**
 * The sign-in screen's "Continue with Google" (`D19.3`, ADR-0072 §4).
 *
 * The form itself is `features/auth`'s suite; this one is about what the
 * *page* composes around it, which is the button and the flag that decides it.
 * Driven through the real route tree because the flag travels on the router's
 * context, and a page rendered alone has no router to read it from.
 *
 * **`window.open` is spied, not a seam invented for the test** — the admin's
 * impersonation suite's choice for its reason: `Location`'s members are
 * unforgeable in jsdom as in a browser, and the button navigates with
 * `window.open(url, "_self")` precisely so the navigation is observable
 * without a module mock (ADR-0036).
 */

const GOOGLE_ON: AppFeatures = { userRegistration: true, googleSignIn: true };
const GOOGLE_OFF: AppFeatures = { userRegistration: true, googleSignIn: false };

let auth: AuthMockState;

beforeEach(() => {
  auth = createAuthMockState();
  server.use(...createAuthHandlers(auth));
  vi.spyOn(window, "open").mockImplementation(() => null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const setup = (features: AppFeatures) => ({
  user: userEvent.setup(),
  // An empty store: `_auth`'s mirror guard sends a signed-in visitor home.
  ...renderApp({
    initialPath: "/login",
    store: createSessionStore(),
    features,
  }),
});

const googleButton = () =>
  screen.queryByRole("button", { name: "Continue with Google" });

describe("continue with Google on the sign-in screen", () => {
  it("is absent from a build without the flag", async () => {
    setup(GOOGLE_OFF);

    // The form arriving is the wait: the page has rendered once it is there.
    expect(
      await screen.findByRole("button", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(googleButton()).toBeNull();
  });

  it("posts start with the reader's locale and sends the browser where it answers", async () => {
    const { user } = setup(GOOGLE_ON);

    await user.click(
      await screen.findByRole("button", { name: "Continue with Google" }),
    );

    await waitFor(() => {
      expect(window.open).toHaveBeenCalledTimes(1);
    });

    expect(auth.googleStartCalls).toEqual([{ locale: "en" }]);
    /*
     * `_self`: the same browsing context, which is what "assign the URL to the
     * window" means (ADR-0072 §4) — and the one form of it a popup blocker has
     * nothing to say about.
     */
    expect(window.open).toHaveBeenCalledWith(GOOGLE_AUTHORIZATION_URL, "_self");
    /*
     * And the button stays disabled: the page is leaving, and a second start
     * would overwrite the transaction cookie the first callback needs.
     */
    expect(googleButton()).toBeDisabled();
  });

  it("comes back pressable when the page is restored from the back/forward cache", async () => {
    /*
     * `D19.3`'s two reviewers: Back from Google's account chooser restores
     * this page as it was left, button disabled, and nothing else would ever
     * re-enable it. `pageshow` with `persisted` is how a page learns it was
     * restored rather than loaded.
     */
    const { user } = setup(GOOGLE_ON);

    await user.click(
      await screen.findByRole("button", { name: "Continue with Google" }),
    );

    await waitFor(() => {
      expect(googleButton()).toBeDisabled();
    });

    // A fresh load says `persisted: false`, and that is not a restore.
    const pageShow = (persisted: boolean) => {
      const event = new Event("pageshow");

      Object.defineProperty(event, "persisted", { value: persisted });
      window.dispatchEvent(event);
    };

    pageShow(false);
    expect(googleButton()).toBeDisabled();

    pageShow(true);
    await waitFor(() => {
      expect(googleButton()).toBeEnabled();
    });
  });

  it("renders the catalogue's sentence when the API has no Google client", async () => {
    const { user } = setup(GOOGLE_ON);

    /*
     * The API's mount is the control (ADR-0072 §4): a build with the button
     * against an API without the client meets `404 ROUTE_NOT_FOUND`, and the
     * person reads the catalogue's sentence for it rather than nothing.
     */
    server.use(
      http.post(`${PUBLIC_API}/auth/google/start`, () =>
        fail(404, "ROUTE_NOT_FOUND"),
      ),
    );

    await user.click(
      await screen.findByRole("button", { name: "Continue with Google" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That address does not exist.",
    );
    expect(window.open).not.toHaveBeenCalled();
    expect(googleButton()).toBeEnabled();
  });

  describe("carrying the screen's redirect through Google", () => {
    /*
     * ADR-0072 §4, amended after `D19.3`: the location the guard or an
     * invitation was sending the person to survives the round trip — carried
     * by this app under its device key, never by the API, and fenced to a
     * path on this origin when it is read back.
     */
    const KEY = "machxi.user.googleRedirect";

    beforeEach(() => {
      server.use(
        ...createProfileHandlers(createProfileMockState()),
        ...createOrganizationsHandlers(createOrganizationsMockState()),
      );
      window.sessionStorage.clear();
    });

    const land = () =>
      renderApp({
        initialPath: `/auth/google#${new URLSearchParams({ token: GOOGLE_HANDOFF_TOKEN }).toString()}`,
        store: createSessionStore(),
      });

    it("stores /login's redirect before leaving, and lands there after the exchange", async () => {
      const user = userEvent.setup();
      const { unmount } = renderApp({
        initialPath: "/login?redirect=/orgs/acme",
        store: createSessionStore(),
        features: GOOGLE_ON,
      });

      await user.click(
        await screen.findByRole("button", { name: "Continue with Google" }),
      );
      await waitFor(() => {
        expect(window.open).toHaveBeenCalledTimes(1);
      });

      expect(window.sessionStorage.getItem(KEY)).toBe("/orgs/acme");

      unmount();

      // Back from Google, in the same tab.
      const { router } = land();

      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/orgs/acme");
      });
      // Read once: nothing is left for a later sign-in to inherit.
      expect(window.sessionStorage.getItem(KEY)).toBeNull();
    });

    it("clears what an abandoned attempt left when this screen has no redirect", async () => {
      window.sessionStorage.setItem(KEY, "/orgs/acme");

      const { user } = setup(GOOGLE_ON);

      await user.click(
        await screen.findByRole("button", { name: "Continue with Google" }),
      );
      await waitFor(() => {
        expect(window.open).toHaveBeenCalledTimes(1);
      });

      expect(window.sessionStorage.getItem(KEY)).toBeNull();
    });

    it.each([
      ["another origin", "https://elsewhere.test/orgs/acme"],
      ["a protocol-relative address", "//elsewhere.test"],
    ])("lands on / when what was stored is %s", async (_name, stored) => {
      window.sessionStorage.setItem(KEY, stored);

      const { router } = land();

      expect(
        await screen.findByRole("heading", { name: "Your account" }),
      ).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/");
    });

    it("lands on / when nothing was stored", async () => {
      const { router } = land();

      expect(
        await screen.findByRole("heading", { name: "Your account" }),
      ).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/");
    });
  });

  it("goes nowhere that is not an https address", async () => {
    const { user } = setup(GOOGLE_ON);

    /*
     * The fence on the one value this screen navigates to. The API is
     * trusted, and the check is not about it: a `javascript:` URL handed to a
     * navigation runs in this origin, whatever produced it.
     */
    server.use(
      http.post(`${PUBLIC_API}/auth/google/start`, () =>
        ok({ authorizationUrl: "javascript:alert(1)" }),
      ),
    );

    await user.click(
      await screen.findByRole("button", { name: "Continue with Google" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong. Try again.",
    );
    expect(window.open).not.toHaveBeenCalled();
  });
});
