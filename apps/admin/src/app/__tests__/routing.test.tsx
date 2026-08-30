import type { StaffRole } from "@repo/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createSessionStore,
  type SessionStore,
} from "@/shared/api/session-store";
import {
  createProfileHandlers,
  createProfileMockState,
} from "@/test/msw/handlers/profile.handlers";
import {
  createStaffHandlers,
  createStaffMockState,
} from "@/test/msw/handlers/staff.handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";
import { staffPrincipal } from "@/test/principals";

/**
 * The route tree, its two pathless layouts and the guards on them (ADR-0032
 * §Layout topology), asserted through the real generated tree.
 *
 * This is the suite the structural-guard claim rests on. ADR-0032 rejects a
 * `<RequireAuth>` wrapper because it is a guard every new page has to remember;
 * what replaces it is a redirect in `beforeLoad` on a layout route, and the
 * only way to know that actually protects a page is to mount the page and see
 * where the router lands. A test that re-declared its own route tree would
 * prove the test's tree instead.
 *
 * The session is scripted rather than stubbed globally, which is what `D3.4`
 * will do for real: the guard reads `context.session`, so a test that hands the
 * router a different session is exercising the production path.
 */

/*
 * A real store rather than a shape-compatible fake: the guard reads
 * `isAuthenticated()`, which is derived from the access token's presence
 * (ADR-0033), so a fake that answered the predicate directly would stop
 * testing the derivation the moment it changed.
 */
const session = (
  isAuthenticated: boolean,
  roles: readonly StaffRole[] = ["admin"],
): SessionStore => {
  const store = createSessionStore();

  // A principal as well as a token since `D4.3`: `can()` reads
  // `principal.roles`, and a store holding one without the other is the
  // mid-bootstrap state rather than a signed-in operator (ADR-0042).
  if (isAuthenticated)
    store.setSession({
      accessToken: "test-access-token",
      principal: staffPrincipal(roles),
    });

  return store;
};

describe("route guards", () => {
  it("sends an unauthenticated visitor from a protected page to /login", async () => {
    renderApp({ initialPath: "/staff", store: session(false) });

    // The login screen, inside the `_auth` shell — not the dashboard.
    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("sends an authenticated visitor away from /login", async () => {
    renderApp({ initialPath: "/login", store: session(true) });

    // The mirror guard on `_auth`: a signed-in operator has no business here.
    expect(
      await screen.findByRole("heading", { name: "Dashboard" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Sign in" }),
      ).not.toBeInTheDocument();
    });
  });

  it("renders a protected page inside the dashboard shell", async () => {
    renderApp({ initialPath: "/staff", store: session(true) });

    expect(
      await screen.findByRole("heading", { name: "Staff" }),
    ).toBeInTheDocument();
    // The shell, not just the page: the sidebar-07 navigation is what makes
    // `_dashboard` a layout rather than a guard with no body.
    expect(screen.getByRole("link", { name: "Users" })).toBeInTheDocument();
  });

  it("shows a manager only the navigation their role can read", async () => {
    /*
     * The half of ADR-0042 that lives in the shell, and the half most likely to
     * regress, because the naive implementation — filter every item by
     * `can("read", item.resource)` — is a bug that looks like a fix: `/` names
     * no resource and is deliberately absent from the policy table, and
     * deny-by-default would therefore hide it from everybody but a
     * `super_admin`.
     *
     * So the assertion is two-sided on purpose. Staff goes, because
     * `/admin/staff` is `authorize("admin")` throughout and a manager cannot
     * read it; Dashboard stays, because **absence of a `resource` means "not
     * gated"** rather than "ask the table". Profile used to be the second
     * ungated item and left the drawer at `D11.10` (ADR-0053 §3), which is why
     * this case now makes the same claim with one example instead of two.
     */
    renderApp({ initialPath: "/", store: session(true, ["manager"]) });

    expect(
      await screen.findByRole("link", { name: "Dashboard" }),
    ).toBeInTheDocument();
    // A manager may read the customer base, so this one stays.
    expect(screen.getByRole("link", { name: "Users" })).toBeInTheDocument();

    expect(
      screen.queryByRole("link", { name: "Staff" }),
    ).not.toBeInTheDocument();
  });

  it("hides nothing from an admin, and nothing from a super admin either", async () => {
    const { unmount } = renderApp({ initialPath: "/", store: session(true) });

    expect(
      await screen.findByRole("link", { name: "Staff" }),
    ).toBeInTheDocument();
    unmount();

    /*
     * `super_admin` reaches everything on the one line in `can` that mirrors
     * ADR-0019's bypass — asserted rather than assumed, because a table that
     * listed the bypass per row instead would drift a row at a time.
     */
    renderApp({ initialPath: "/", store: session(true, ["super_admin"]) });

    expect(
      await screen.findByRole("link", { name: "Staff" }),
    ).toBeInTheDocument();
  });

  it("titles the shell from the route's own staticData", async () => {
    renderApp({ initialPath: "/account/profile", store: session(true) });

    // Declared on the route rather than looked up in the layout, so a page and
    // its heading cannot drift apart.
    expect(
      await screen.findByRole("heading", { name: "Profile" }),
    ).toBeInTheDocument();
  });
});

/**
 * The vertical strategy, read off the same channel as the title (`D4.1`,
 * ADR-0037 §Full-height mode is a page choice).
 *
 * Geometry itself is not assertable here — jsdom lays nothing out, so no test
 * in this tier can say the pager stayed put or the rows scrolled; that is what
 * the deliverable's manual walk is for. What *is* assertable is the decision
 * that produces the geometry: which pages asked for a height budget. Asserting
 * it through the real route tree is the point, because the failure this guards
 * against is a new page silently inheriting the wrong strategy.
 */
describe("page vertical strategy", () => {
  /*
   * These pages fetch, and ADR-0036 makes an unhandled request an error — so
   * the two screens below get their handlers even though nothing here asserts
   * a row. A page rendering its error surface is not the page whose frame is
   * being checked.
   */
  beforeEach(() => {
    server.use(
      ...createStaffHandlers(createStaffMockState()),
      ...createProfileHandlers(createProfileMockState()),
    );
  });

  const pageContainer = () =>
    document.querySelector('[data-slot="page-container"]');

  it("budgets the height of a grid page", async () => {
    renderApp({ initialPath: "/staff", store: session(true) });
    await screen.findByRole("heading", { name: "Staff" });

    expect(pageContainer()).toHaveAttribute("data-full-height");
  });

  it("leaves a form page in normal document flow", async () => {
    renderApp({ initialPath: "/account/profile", store: session(true) });
    await screen.findByRole("heading", { name: "Profile" });

    // A form taller than the viewport should scroll as a document, not inside
    // a pane — so the absence here is the decision, not an oversight.
    expect(pageContainer()).not.toHaveAttribute("data-full-height");
  });

  it("leaves the dashboard index in normal document flow", async () => {
    renderApp({ initialPath: "/", store: session(true) });
    await screen.findByRole("heading", { name: "Dashboard" });

    expect(pageContainer()).not.toHaveAttribute("data-full-height");
  });
});

/**
 * The account area's route family (`D11.9`, ADR-0053 §1).
 *
 * Four addresses and two redirects, asserted through the generated tree for
 * the reason the guards above are: a redirect declared in a `beforeLoad` is
 * only a redirect if the router runs it, and a section is only deep-linkable
 * if landing on its URL renders *it* rather than the area's first section.
 *
 * The titles are the observable half of "its own `staticData`": the shell's
 * `<h1>` is the deepest match that declares one (`route-meta`), so a section
 * that forgot to declare a title would silently inherit `Account` and the
 * breadcrumb would read `Account → Account`.
 */
describe("the account area", () => {
  beforeEach(() => {
    server.use(...createProfileHandlers(createProfileMockState()));
  });

  const heading = (name: string) =>
    screen.findByRole("heading", { level: 1, name });

  /**
   * Where the router *landed*, as opposed to what a route declared.
   *
   * The `D11.9` review's second finding, and it is the whole point of the two
   * redirect cases below: a heading and a crumb are both read off
   * `staticData`, so an index route that rendered the profile section directly
   * — leaving the address bar on `/account` — would satisfy them exactly as a
   * redirect does. The section nav's active item is computed by TanStack from
   * the resolved pathname, so this is the one thing on screen that can only be
   * true if the navigation happened.
   */
  const activeSection = async (): Promise<string | null> =>
    within(await screen.findByRole("navigation", { name: "Account sections" }))
      .getAllByRole("link")
      .find((link) => link.getAttribute("data-active") === "true")
      ?.textContent ?? null;

  it.each([
    ["/account/profile", "Profile", "Your account"],
    ["/account/security", "Security", "Password"],
    ["/account/preferences", "Preferences", "Appearance"],
  ])(
    "deep-links %s with its own title",
    async (path, title, body: string | undefined) => {
      renderApp({ initialPath: path, store: session(true) });

      expect(await heading(title)).toBeInTheDocument();
      // The area's own crumb is above it, which is what makes the section a
      // section rather than a fourth top-level page (ADR-0048 §2).
      expect(
        within(
          await screen.findByRole("navigation", { name: "breadcrumb" }),
        ).getByRole("link", { name: "Account" }),
      ).toHaveAttribute("href", "/account");
      /*
       * And the section's own body, not only its `staticData` (the `D11.9`
       * review's fourth finding): a route file that forgot its `component`,
       * or two that swapped theirs, would leave the title and the crumb
       * exactly as they are.
       */
      if (body !== undefined)
        expect(await screen.findByText(body)).toBeInTheDocument();
    },
  );

  it("sends /account to the first section", async () => {
    renderApp({ initialPath: "/account", store: session(true) });

    // The index route holds no screen of its own, so the operator never sees
    // the frame with an empty pane — and the address moved with the screen.
    expect(await heading("Profile")).toBeInTheDocument();
    expect(await activeSection()).toBe("Profile");
  });

  it("keeps the bookmarked /profile working", async () => {
    renderApp({ initialPath: "/profile", store: session(true) });

    // ADR-0053 §1: the screen moved and the address stayed behind, so nothing
    // bookmarked breaks — the operator lands *on* `/account/profile` rather
    // than seeing it rendered under the old address.
    expect(await heading("Profile")).toBeInTheDocument();
    expect(await activeSection()).toBe("Profile");
    expect(
      screen.getByRole("region", { name: "Your account" }),
    ).toBeInTheDocument();
  });

  it("names the section nav so it is not a second unnamed landmark", async () => {
    renderApp({ initialPath: "/account/profile", store: session(true) });

    // ADR-0053 §4 as amended at `D11.8`: the page already carries the shell's
    // breadcrumb `<nav>`, so an anonymous second one would give a screen
    // reader two identical entries. The three links are the app's, the name is
    // the app's, and the composition only places them.
    const nav = await screen.findByRole("navigation", {
      name: "Account sections",
    });

    expect(within(nav).getAllByRole("link")).toHaveLength(3);
  });

  it("keeps the area out of the primary nav", async () => {
    renderApp({ initialPath: "/", store: session(true) });

    await screen.findByRole("heading", { level: 1, name: "Dashboard" });

    /*
     * ADR-0053 §3, and the reason it is asserted from the drawer rather than
     * from the item that left: the decision is that the sidebar is *domain*
     * navigation, so what must stay true is that no entry in it goes to the
     * account area — not merely that one particular label is gone. A future
     * `Preferences` item would pass a `queryByRole("link", { name: "Profile"
     * })` and break the decision.
     */
    const drawer = document.querySelector('[data-slot="sidebar"]');

    expect(drawer).toBeInTheDocument();

    const destinations = within(drawer as HTMLElement)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href") ?? "");

    expect(destinations.length).toBeGreaterThan(0);
    expect(
      destinations.filter(
        (href) => href === "/profile" || href.startsWith("/account"),
      ),
    ).toEqual([]);
  });
});
