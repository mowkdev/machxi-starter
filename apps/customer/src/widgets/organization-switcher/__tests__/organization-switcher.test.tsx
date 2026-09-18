import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { organizationStorageKey } from "@/entities/organization";
import {
  API,
  createAuthHandlers,
  createAuthMockState,
} from "@/test/msw/handlers/auth.handlers";
import { fail, server } from "@repo/app-kit/testing";
import {
  ORGANIZATION_ROWS,
  SECOND_TEAM_ORGANIZATION,
  TEAM_ORGANIZATION,
  createOrganizationsHandlers,
  createOrganizationsMockState,
  type OrganizationsMockState,
} from "@/test/msw/handlers/organizations.handlers";
import {
  createProfileHandlers,
  createProfileMockState,
} from "@/test/msw/handlers/profile.handlers";
import { authenticated, userPrincipal } from "@/test/principals";
import { renderApp } from "@/test/render";

/**
 * The organization switcher (`D15.5`; reshaped at `D15.9`, ADR-0067 §6 as
 * amended 2026-09-07).
 *
 * **What is under test is that the control *switches*.** `D15.5`'s suite
 * asserted that choosing an organization navigated to its screen, which was a
 * true description of a control that turned out to be wrong: it took a customer
 * to a summary card whose one action was settings, so "switching" and "opening
 * settings" were the same gesture. The assertions here are about the property
 * the amendment actually asks for — the screen survives the switch and only the
 * prefix moves — which is why two of them start somewhere other than the home.
 *
 * `renderApp` rather than the widget in isolation, because every one of these is
 * a navigation: a test rendering the widget alone could only assert an `href`,
 * and since `D15.9` there is no `href` to assert — the destination is a function
 * of where the caller already is.
 */
let state: OrganizationsMockState;

beforeEach(() => {
  state = createOrganizationsMockState();

  server.use(
    ...createAuthHandlers(createAuthMockState()),
    ...createProfileHandlers(createProfileMockState()),
    ...createOrganizationsHandlers(state),
  );
});

afterEach(() => {
  localStorage.clear();
});

const openSwitcher = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(
    await screen.findByRole("button", { name: "Switch organization" }),
  );

  return screen.findByRole("menu");
};

const chooseContext = async (
  user: ReturnType<typeof userEvent.setup>,
  name: string | RegExp,
) => {
  const menu = await openSwitcher(user);

  await user.click(await within(menu).findByRole("menuitem", { name }));
};

describe("the organization switcher", () => {
  it("lists the private context and every team the caller holds", async () => {
    const user = userEvent.setup();

    renderApp({ initialPath: "/", store: authenticated() });

    const menu = await openSwitcher(user);

    /*
     * The private entry is labelled rather than named: ADR-0067 §6 makes a
     * personal organization's name unmanaged, so the interface calls it
     * "Private" instead of showing a value nothing can edit.
     */
    expect(
      await within(menu).findByRole("menuitem", { name: /Private/ }),
    ).toBeInTheDocument();

    for (const team of ORGANIZATION_ROWS.filter((row) => row.kind === "team"))
      expect(
        await within(menu).findByRole("menuitem", {
          name: new RegExp(team.name),
        }),
      ).toBeInTheDocument();

    /*
     * The personal organization's *name* must not appear as an entry of its
     * own: it is the private context and listing it twice would offer a second,
     * broken way in — the slug it would carry is one the resolver refuses.
     */
    expect(
      within(menu).queryByRole("menuitem", { name: /Cara Customer/ }),
    ).not.toBeInTheDocument();
  });

  it("lands on a team's home when chosen from the private home", async () => {
    const user = userEvent.setup();

    const { router } = renderApp({ initialPath: "/", store: authenticated() });

    await chooseContext(user, new RegExp(TEAM_ORGANIZATION.name));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/orgs/${TEAM_ORGANIZATION.slug}`,
      );
    });

    /*
     * The slug and not the id, which is ADR-0067 §6's whole point: a customer's
     * URL and the API's path say the same thing in two vocabularies, and the
     * resolver is the one place the translation happens.
     */
    expect(router.state.location.pathname).not.toContain(TEAM_ORGANIZATION.id);
  });

  it("keeps the section when switching from one team to another", async () => {
    const user = userEvent.setup();

    const { router } = renderApp({
      initialPath: `/orgs/${TEAM_ORGANIZATION.slug}/settings/members`,
      store: authenticated(),
    });

    await chooseContext(user, new RegExp(SECOND_TEAM_ORGANIZATION.name));

    /*
     * **The assertion the amendment exists for.** A customer comparing two
     * teams' member lists stays on the member list; a switcher that navigated
     * to a fixed screen would land on `/orgs/beacon` and pass every other test
     * in this file.
     */
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/orgs/${SECOND_TEAM_ORGANIZATION.slug}/settings/members`,
      );
    });
  });

  it("lands on the private home when a team's settings has no counterpart there", async () => {
    const user = userEvent.setup();

    const { router } = renderApp({
      initialPath: `/orgs/${TEAM_ORGANIZATION.slug}/settings/members`,
      store: authenticated(),
    });

    await chooseContext(user, /Private/);

    /*
     * The private context has no settings surface at all (ADR-0067 §6), so the
     * screen has nowhere to be kept and the rule falls back to that context's
     * home rather than to a not-found.
     */
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
  });

  it("names the context the caller is standing in", async () => {
    const { router } = renderApp({
      initialPath: "/",
      store: authenticated(),
    });

    /*
     * The trigger's *accessible* name is constant on purpose, so the label a
     * customer reads is asserted as its content rather than as its name — and
     * the assertion is that the control follows the URL rather than holding
     * state of its own.
     */
    const trigger = await screen.findByRole("button", {
      name: "Switch organization",
    });

    await waitFor(() => {
      expect(trigger).toHaveTextContent("Private");
    });

    await router.navigate({
      params: { orgSlug: TEAM_ORGANIZATION.slug },
      to: "/orgs/$orgSlug",
    });

    await waitFor(() => {
      expect(trigger).toHaveTextContent(TEAM_ORGANIZATION.name);
    });
  });

  it("names the last visited team while the caller is on a self-scoped screen", async () => {
    /*
     * The second of the remembered key's exactly two consumers (ADR-0067 §6).
     * `/account/*` belongs to the person rather than to a tenant, so opening
     * one's profile from a team must not eject the customer into the private
     * context on the way back — the switcher goes on naming the team.
     *
     * Seeded directly rather than by walking there first, so what is asserted is
     * the *read* rather than a write this test also performed.
     */
    localStorage.setItem(
      organizationStorageKey(userPrincipal().id),
      TEAM_ORGANIZATION.slug,
    );

    renderApp({ initialPath: "/account/profile", store: authenticated() });

    const trigger = await screen.findByRole("button", {
      name: "Switch organization",
    });

    await waitFor(() => {
      expect(trigger).toHaveTextContent(TEAM_ORGANIZATION.name);
    });
  });

  it("falls back to the private context when the remembered team is not a membership", async () => {
    /*
     * The value lives on the customer's own device, so a team they have been
     * removed from would otherwise name a tenant they can no longer reach —
     * forever, with nothing a server response could do about it.
     */
    localStorage.setItem(
      organizationStorageKey(userPrincipal().id),
      "left-this-one",
    );

    renderApp({ initialPath: "/account/profile", store: authenticated() });

    const trigger = await screen.findByRole("button", {
      name: "Switch organization",
    });

    await waitFor(() => {
      expect(trigger).toHaveTextContent("Private");
    });
  });

  it("opens the active team's settings from its menu", async () => {
    const user = userEvent.setup();

    const { router } = renderApp({
      initialPath: `/orgs/${TEAM_ORGANIZATION.slug}`,
      store: authenticated(),
    });

    const menu = await openSwitcher(user);

    await user.click(
      await within(menu).findByRole("menuitem", {
        name: "Organization settings",
      }),
    );

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/orgs/${TEAM_ORGANIZATION.slug}/settings/general`,
      );
    });
  });

  it("offers no settings entry from the private context", async () => {
    const user = userEvent.setup();

    renderApp({ initialPath: "/", store: authenticated() });

    const menu = await openSwitcher(user);

    /*
     * A personal organization has no settings surface (ADR-0067 §6), so an
     * entry here would open a screen that renders not-found. Awaited on the
     * private entry first, so the absence is asserted against a menu that has
     * actually filled rather than against one still arriving.
     */
    await within(menu).findByRole("menuitem", { name: /Private/ });

    expect(
      within(menu).queryByRole("menuitem", { name: "Organization settings" }),
    ).not.toBeInTheDocument();
  });

  it("creates an organization from its menu rather than from a screen", async () => {
    const user = userEvent.setup();

    renderApp({ initialPath: "/", store: authenticated() });

    const menu = await openSwitcher(user);

    await user.click(
      await within(menu).findByRole("menuitem", { name: "New organization" }),
    );

    /*
     * The entry opens a dialog and navigates nowhere, which is the division
     * ADR-0067 §6 draws: the menu decides where you stand, and the write happens
     * on a surface of its own.
     */
    expect(
      await screen.findByRole("dialog", { name: "New organization" }),
    ).toBeInTheDocument();
  });

  it("leaves the shell reachable after the create dialog closes", async () => {
    const user = userEvent.setup();

    renderApp({ initialPath: "/", store: authenticated() });

    const menu = await openSwitcher(user);

    await user.click(
      await within(menu).findByRole("menuitem", { name: "New organization" }),
    );

    await screen.findByRole("dialog", { name: "New organization" });

    await user.keyboard("{Escape}");

    /*
     * **The regression this pins was found in the browser, not here** — and the
     * reason jsdom missed it is the reason this case exists: the suite above
     * opens the dialog and never closes it.
     *
     * The entry used to `preventDefault` on select, borrowed from
     * `AccountMenu`'s sign-out. That keeps the *menu* open, so the dialog opened
     * beneath a second modal layer, and dismissing the dialog left Radix's
     * `aria-hidden` on everything outside the menu — the shell's header
     * included. The switcher then existed in the DOM and not as a role, which
     * is precisely how a screen reader would have found it.
     */
    expect(
      await screen.findByRole("button", { name: "Switch organization" }),
    ).toBeInTheDocument();
  });

  it("says a read failed rather than reporting an account with no teams", async () => {
    const user = userEvent.setup();

    /*
     * The distinction `D15.4`'s review drew on the admin's members table: an
     * empty menu and a failed one look identical in the DOM, and telling
     * somebody they belong to nothing because a request failed is a silent
     * failure the client manufactured.
     */
    server.use(http.get(`${API}/orgs`, () => fail(500, "INTERNAL_ERROR")));

    renderApp({ initialPath: "/", store: authenticated() });

    const menu = await openSwitcher(user);

    /*
     * Awaited: a `5xx` is retried twice before the query gives up (ADR-0034's
     * policy retries anything that is not a refusal), so the failure branch is
     * a few seconds out rather than immediate.
     */
    expect(
      await within(menu).findByText("Your organizations could not be loaded."),
    ).toBeInTheDocument();
    /*
     * And the private entry is gone with it — a switcher that offered a context
     * while its own list had failed would be claiming knowledge it does not
     * have.
     */
    expect(
      within(menu).queryByRole("menuitem", { name: /Private/ }),
    ).not.toBeInTheDocument();
  });

  it("remembers the team a customer is standing in, under that principal's key", async () => {
    const { router } = renderApp({
      initialPath: `/orgs/${TEAM_ORGANIZATION.slug}`,
      store: authenticated(),
    });

    const key = organizationStorageKey(userPrincipal().id);

    /*
     * **Written from the URL rather than from the click**, which is what makes
     * it true after a reload or a pasted link: this test never opens the menu.
     */
    await waitFor(() => {
      expect(localStorage.getItem(key)).toBe(TEAM_ORGANIZATION.slug);
    });

    await router.navigate({ to: "/" });

    // And forgotten on the private context, so "never chose" and "chose
    // private" stay one state rather than two spellings of it.
    await waitFor(() => {
      expect(localStorage.getItem(key)).toBeNull();
    });
  });

  it("keeps the drawer's links in the remembered team on a self-scoped screen", async () => {
    const user = userEvent.setup();

    /*
     * **The other half of ADR-0067 §6's sentence**, and a review finding: the
     * record names two shell consumers of the remembered context — the switcher
     * *and the links* — and the first version read the URL in `AppSidebar`, so a
     * customer who opened their profile from a team was sent to `/` by the very
     * next click. The switcher's own label was right the whole time, which is
     * why nothing caught it.
     */
    localStorage.setItem(
      organizationStorageKey(userPrincipal().id),
      TEAM_ORGANIZATION.slug,
    );

    const { router } = renderApp({
      initialPath: "/account/profile",
      store: authenticated(),
    });

    const home = await screen.findByRole("link", { name: "Home" });

    await user.click(home);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/orgs/${TEAM_ORGANIZATION.slug}`,
      );
    });
  });

  it("does not remember an address that resolved to nothing", async () => {
    const key = organizationStorageKey(userPrincipal().id);

    localStorage.setItem(key, TEAM_ORGANIZATION.slug);

    /*
     * A review finding, and silent in every direction: the first version wrote
     * `slug` whatever the resolution said, so opening a colleague's link to a
     * tenant you are not in — a not-found on screen — overwrote the team you
     * actually work in. The read side filters the junk value, so the only
     * symptom was every later sign-in landing on the private home.
     */
    renderApp({
      initialPath: "/orgs/somebody-elses-tenant",
      store: authenticated(),
    });

    await screen.findByText("That address does not exist.");

    expect(localStorage.getItem(key)).toBe(TEAM_ORGANIZATION.slug);
  });

  it("does not overwrite the remembered team while on a self-scoped screen", async () => {
    const key = organizationStorageKey(userPrincipal().id);

    localStorage.setItem(key, TEAM_ORGANIZATION.slug);

    renderApp({ initialPath: "/account/profile", store: authenticated() });

    await screen.findByRole("button", { name: "Switch organization" });

    /*
     * `/account/profile` carries no slug, so a writer that did not exempt
     * self-scoped screens would clear the very value the account area is
     * reading back — and the switcher would forget the team on the way to a
     * customer's own profile.
     */
    await waitFor(() => {
      expect(localStorage.getItem(key)).toBe(TEAM_ORGANIZATION.slug);
    });
  });
});
