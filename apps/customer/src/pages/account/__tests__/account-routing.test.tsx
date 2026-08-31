import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createAuthHandlers,
  createAuthMockState,
} from "@/test/msw/handlers/auth.handlers";
import {
  createProfileHandlers,
  createProfileMockState,
} from "@/test/msw/handlers/profile.handlers";
import { server } from "@/test/msw/server";
import { authenticated } from "@/test/principals";
import { renderApp } from "@/test/render";

/**
 * The `/account` route family, asserted through the real generated tree
 * (`D12.6`; ADR-0053 §1, ADR-0044's heading rule).
 *
 * `renderApp` rather than rendering `AccountPage` with a section handed to it,
 * because what is under test is the routing: the index route's redirect, the
 * per-section `staticData.title` the shell's band reads, and the fact that each
 * section is reachable from a cold URL. A hand-built tree would prove the
 * test's tree — and the deep-link claim in particular is only worth making
 * against the router the app ships.
 *
 * **The heading is the shell's, not the page's** (ADR-0054 §5, and ADR-0044's
 * rule that a record route names itself). No component in `pages/account`
 * renders an `<h1>`; the page-header band resolves `staticData.title` through
 * `useRouteTitle`. So an assertion on `heading, level 1` is an assertion that
 * the route declared a title *and* that the band read it, which is exactly the
 * pair that can silently come apart.
 */
beforeEach(() => {
  server.use(
    ...createAuthHandlers(createAuthMockState()),
    ...createProfileHandlers(createProfileMockState()),
  );
});

describe("the account area's routes", () => {
  it("sends /account to the profile section rather than showing an empty frame", async () => {
    const { router } = renderApp({
      initialPath: "/account",
      store: authenticated(),
    });

    expect(
      await screen.findByRole("heading", { level: 1, name: "Profile" }),
    ).toBeInTheDocument();
    /*
     * The redirect is `beforeLoad`'s, so the frame with an empty content pane
     * is never rendered at all — the location has already moved by the time
     * anything paints. Asserting the pathname is what says that: a component
     * that redirected on mount would land here too, one paint later.
     */
    expect(router.state.location.pathname).toBe("/account/profile");
  });

  it("deep-links each section, each naming itself", async () => {
    const sections = [
      { path: "/account/profile", title: "Profile" },
      { path: "/account/security", title: "Security" },
    ] as const;

    for (const { path, title } of sections) {
      const { router, unmount } = renderApp({
        initialPath: path,
        store: authenticated(),
      });

      expect(
        await screen.findByRole("heading", { level: 1, name: title }),
      ).toBeInTheDocument();
      expect(router.state.location.pathname).toBe(path);

      unmount();
    }
  });

  it("names its own nav landmark, so the shell's is not the only one", async () => {
    renderApp({ initialPath: "/account/profile", store: authenticated() });

    await screen.findByRole("heading", { level: 1, name: "Profile" });

    /*
     * ADR-0053 §4 as amended at `D11.8`: `navLabel` is required precisely so a
     * consumer cannot render an anonymous second landmark. The drawer is the
     * other one on this page, which is why the assertion is by name rather
     * than by count.
     */
    expect(
      screen.getByRole("navigation", { name: "Account sections" }),
    ).toBeInTheDocument();
  });

  it("walks between sections without leaving the area's frame", async () => {
    const user = userEvent.setup();
    const { router } = renderApp({
      initialPath: "/account/profile",
      store: authenticated(),
    });

    await screen.findByRole("heading", { level: 1, name: "Profile" });

    const nav = screen.getByRole("navigation", { name: "Account sections" });

    await user.click(within(nav).getByRole("link", { name: "Security" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Security" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/account/security");
    // The frame is a layout route, so it survives the navigation — the nav
    // itself is the proof, since a full remount would have rebuilt it.
    expect(
      screen.getByRole("navigation", { name: "Account sections" }),
    ).toBeInTheDocument();
  });

  it("marks the section you are on, in the sidebar's own idiom", async () => {
    renderApp({ initialPath: "/account/security", store: authenticated() });

    await screen.findByRole("heading", { level: 1, name: "Security" });

    const nav = screen.getByRole("navigation", { name: "Account sections" });

    /*
     * `data-active` rather than a class, because the class is ADR-0054 §5's
     * geometry and this suite must not pin geometry — what it pins is that
     * `activeProps` is wired to the router at all, which is the half that
     * would silently rot if a section were added by hand.
     */
    expect(within(nav).getByRole("link", { name: "Security" })).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(
      within(nav).getByRole("link", { name: "Profile" }),
    ).not.toHaveAttribute("data-active");
  });

  it("keeps the area behind the dashboard guard", async () => {
    /*
     * The structural claim of ADR-0049 §Layout topology, checked where it is
     * cheapest to get wrong: `_dashboard.account.*` inherits the guard because
     * of where the files sit, and nothing in any of them says so.
     */
    const { router } = renderApp({ initialPath: "/account/security" });

    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/login");
    });
    expect(router.state.location.search).toEqual({
      redirect: "/account/security",
    });
  });
});
