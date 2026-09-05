import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import {
  API,
  createAuthHandlers,
  createAuthMockState,
} from "@/test/msw/handlers/auth.handlers";
import { fail } from "@/test/msw/handlers/envelope";
import {
  ORGANIZATION_ROWS,
  TEAM_ORGANIZATION,
  createOrganizationsHandlers,
  createOrganizationsMockState,
  type OrganizationsMockState,
} from "@/test/msw/handlers/organizations.handlers";
import {
  createProfileHandlers,
  createProfileMockState,
} from "@/test/msw/handlers/profile.handlers";
import { server } from "@repo/app-kit/testing";
import { authenticated } from "@/test/principals";
import { renderApp } from "@/test/render";

/**
 * The organization switcher (`D15.5`, ADR-0067 §6).
 *
 * `renderApp` rather than the widget in isolation, because what is under test
 * is a **navigation**: the control has to put the router on `/orgs/<slug>`, and
 * a test that rendered the widget alone could only assert an `href`. It is also
 * the honest way to check that the control is in the shell at all, which is the
 * property every other screen in this app now depends on — the slug resolution
 * of ADR-0067 §6 works because this query has already been made.
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

const openSwitcher = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(
    await screen.findByRole("button", { name: "Switch organization" }),
  );

  return screen.findByRole("menu");
};

describe("the organization switcher", () => {
  it("lists every membership the caller holds", async () => {
    const user = userEvent.setup();

    renderApp({ initialPath: "/", store: authenticated() });

    const menu = await openSwitcher(user);

    /*
     * By a name *containing* the organization's, because the personal one
     * carries a badge inside the item and the badge is part of its accessible
     * name. Asserting the exact string would have pinned the badge's copy into
     * a test about the list.
     */
    for (const organization of ORGANIZATION_ROWS)
      expect(
        await within(menu).findByRole("menuitem", {
          name: new RegExp(organization.name),
        }),
      ).toBeInTheDocument();

    /*
     * Every one and no more: a switcher that dropped a row would still pass the
     * loop above if the loop were the only assertion, and the whole point of
     * this control is that a customer can reach *all* of their tenants from it.
     */
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(
      ORGANIZATION_ROWS.length,
    );
  });

  it("navigates to the organization it names", async () => {
    const user = userEvent.setup();

    const { router } = renderApp({ initialPath: "/", store: authenticated() });

    const menu = await openSwitcher(user);

    await user.click(
      await within(menu).findByRole("menuitem", {
        name: new RegExp(TEAM_ORGANIZATION.name),
      }),
    );

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/orgs/${TEAM_ORGANIZATION.slug}`,
      );
    });

    /*
     * The slug and not the id, which is ADR-0067 §6's whole point: a customer's
     * URL and the API's path say the same thing in two vocabularies, and this
     * is the one place the translation happens.
     */
    expect(router.state.location.pathname).not.toContain(TEAM_ORGANIZATION.id);
  });

  it("names the organization you are standing in", async () => {
    renderApp({
      initialPath: `/orgs/${TEAM_ORGANIZATION.slug}`,
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

    // Awaited, because the label is the *list's* answer arriving rather than
    // the URL's: the control renders before the query settles, with the
    // neutral label the shell shows off an organization route.
    await waitFor(() => {
      expect(trigger).toHaveTextContent(TEAM_ORGANIZATION.name);
    });
  });

  it("says so when the account is in no organization", async () => {
    const user = userEvent.setup();

    state.organizations = [];

    renderApp({ initialPath: "/", store: authenticated() });

    const menu = await openSwitcher(user);

    expect(
      within(menu).getByText("You are not in any organization yet."),
    ).toBeInTheDocument();
  });

  it("says a read failed rather than reporting an account with no organizations", async () => {
    const user = userEvent.setup();

    /*
     * The distinction `D15.4`'s review drew on the admin's members table,
     * carried here because this control has the same failure available to it:
     * an empty menu and a failed one look identical in the DOM, and telling
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
    expect(
      within(menu).queryByText("You are not in any organization yet."),
    ).not.toBeInTheDocument();
  });
});
