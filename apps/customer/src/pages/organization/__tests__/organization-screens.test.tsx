import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import {
  API,
  createAuthHandlers,
  createAuthMockState,
} from "@/test/msw/handlers/auth.handlers";
import { fail, ok, server } from "@repo/app-kit/testing";
import {
  PERSONAL_ORGANIZATION,
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
import { authenticated } from "@/test/principals";
import { renderApp } from "@/test/render";

/**
 * A team's screens (`D15.5`; reshaped at `D15.9`, ADR-0067 §4, §6 as amended
 * 2026-09-07).
 *
 * Through the real generated route tree, because most of the claims here are
 * about routing rather than about a component: that the private context's slug
 * is not an address at all, that an unknown one is a not-found decided in the
 * browser, that the settings area lands on its first section, and that renaming
 * an organization's address moves the page onto the new one.
 *
 * **The summary screen `D15.5` asserted is gone** and so are its tests: the
 * amendment retires the card whose one action was its own settings, and the
 * home screen it is replaced by is the same page `/` mounts — which is asserted
 * where that page's other address is, in the route walk.
 */
let state: OrganizationsMockState;

/**
 * Every request the app made, so "without a request" can be asserted rather
 * than assumed.
 *
 * MSW's own event stream and not a spy on the client: what the claim is about
 * is the wire, and a handler-level counter would miss a request that no handler
 * answered — which is exactly the request this suite is looking for the absence
 * of.
 */
let requested: string[];

beforeEach(() => {
  state = createOrganizationsMockState();
  requested = [];

  const record = ({ request }: { request: Request }) => {
    requested.push(request.url);
  };

  server.events.on("request:start", record);

  server.use(
    ...createAuthHandlers(createAuthMockState()),
    ...createProfileHandlers(createProfileMockState()),
    ...createOrganizationsHandlers(state),
  );

  return () => {
    server.events.removeListener("request:start", record);
  };
});

const teamPath = `/orgs/${TEAM_ORGANIZATION.slug}`;

/** Requests addressed *at* an organization, which is the set that must stay empty. */
const organizationRequests = () =>
  requested.filter((url) => /\/user\/orgs\/[^?]/.test(url));

describe("a team's settings area", () => {
  it("lands on the first section", async () => {
    const { router } = renderApp({
      initialPath: `${teamPath}/settings`,
      store: authenticated(),
    });

    /*
     * The arrangement `/account` already has (ADR-0053 §1): the area has no
     * landing screen of its own, so `beforeLoad` redirects rather than letting
     * anybody see the frame with an empty content pane.
     */
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `${teamPath}/settings/general`,
      );
    });
  });

  it("round-trips a name change from the general section", async () => {
    const user = userEvent.setup();

    renderApp({
      initialPath: `${teamPath}/settings/general`,
      store: authenticated(),
    });

    const name = await screen.findByLabelText("Name");

    await user.clear(name);
    await user.type(name, "Acme Holdings");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(state.seen.updated.at(-1)).toEqual({
        organizationId: TEAM_ORGANIZATION.id,
        body: { name: "Acme Holdings" },
      });
    });

    /*
     * Only what changed is sent: `dirtyValuesOf` prunes the submit, so an
     * untouched address is not re-sent — which is what makes the contract's
     * "provide at least one field" refinement measure a real edit.
     */
    expect(state.seen.updated.at(-1)?.body.slug).toBeUndefined();

    // And the new name is on screen, which is the invalidation of the
    // switcher's list coming back rather than the form keeping its own copy.
    expect(
      await screen.findByText("The organization was updated."),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Switch organization" }),
      ).toHaveTextContent("Acme Holdings");
    });
  });

  it("lists the members in the members section", async () => {
    renderApp({
      initialPath: `${teamPath}/settings/members`,
      store: authenticated(),
    });

    expect(
      await screen.findByRole("cell", { name: "morgan@machxi.local" }),
    ).toBeInTheDocument();
  });

  it("lists the pending invitations in the invitations section", async () => {
    renderApp({
      initialPath: `${teamPath}/settings/invitations`,
      store: authenticated(),
    });

    expect(
      await screen.findByRole("button", { name: "Invite somebody" }),
    ).toBeInTheDocument();
  });

  it("moves the page when the address changes", async () => {
    const user = userEvent.setup();

    const { router } = renderApp({
      initialPath: `${teamPath}/settings/general`,
      store: authenticated(),
    });

    /*
     * The switcher's list, slow from its **second** call on — which is the
     * refetch this write invalidates. Without it the mock answers instantly and
     * the window this test is about does not exist; with it, the moment the
     * router lands on the new address the cached list still holds the old slug,
     * which is exactly the state the resolver has to not call a not-found.
     */
    let listCalls = 0;

    server.use(
      http.get(`${API}/orgs`, async () => {
        listCalls += 1;

        if (listCalls > 1) await delay(200);

        return ok(state.organizations);
      }),
    );

    const slug = await screen.findByLabelText("Address");

    await user.clear(slug);
    await user.type(slug, "acme-holdings");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    /*
     * The address in the URL *is* the organization's slug (ADR-0067 §6), so a
     * saved address leaves the browser on a path that no longer resolves — a
     * not-found the moment the switcher's list comes back. The form navigates,
     * which is the one thing about it that is routing rather than a write.
     */
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        "/orgs/acme-holdings/settings/general",
      );
    });

    /*
     * Asserted **while the refetch is still in flight**, which is the whole
     * point and a review's finding: the write invalidates the switcher's list
     * and navigates, so for the length of the refetch the cached list holds no
     * such slug — and a resolver reading `isSuccess` alone answers not-found on
     * the screen a customer reaches immediately after "The organization was
     * updated." A version of this test that only waited for the destination
     * would pass either way, because the flash clears itself.
     */
    expect(
      screen.queryByText("That address does not exist."),
    ).not.toBeInTheDocument();

    // And the destination does arrive, once the list catches up.
    expect(await screen.findByLabelText("Address")).toHaveValue(
      "acme-holdings",
    );
  });

  it("leaves an organization that has another owner, quietly", async () => {
    const user = userEvent.setup();

    /*
     * The other member promoted, so the caller is not the last owner and the
     * invariant is not what this test is about. What it is about is the *quiet*
     * part: leaving removes the organization's cached detail while its members
     * table is still mounted, and a members query that refetched into a `404`
     * on the way out would put "The members could not be loaded." on screen
     * behind "You left the organization." (a review's uncertain finding, pinned
     * here rather than reasoned about).
     */
    state.memberships = state.memberships.map((row) =>
      row.email === "morgan@machxi.local" ? { ...row, role: "owner" } : row,
    );

    const { router } = renderApp({
      initialPath: `${teamPath}/settings/members`,
      store: authenticated(),
    });

    await user.click(await screen.findByRole("button", { name: "Leave" }));

    const dialog = within(await screen.findByRole("alertdialog"));

    await user.click(dialog.getByRole("button", { name: "Leave" }));

    expect(
      await screen.findByText("You left the organization."),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
    expect(
      screen.queryByText("The members could not be loaded."),
    ).not.toBeInTheDocument();
  });

  it("refuses the last owner's demotion, in the catalogue's words", async () => {
    const user = userEvent.setup();

    renderApp({
      initialPath: `${teamPath}/settings/members`,
      store: authenticated(),
    });

    // The second member has to be on screen before the row controls are asked
    // for, or the roles below could be a one-row table.
    await screen.findByRole("cell", { name: "morgan@machxi.local" });

    /*
     * The caller's own row is the first: they are the team's only owner, so
     * demoting themselves is the invariant ADR-0067 §2 refuses — one owner at
     * minimum, enforced in one place for both this write and the removal below.
     */
    const [ownRole] = screen.getAllByRole("combobox", { name: "Change role" });

    if (ownRole === undefined) throw new Error("no role control rendered");

    await user.click(ownRole);
    await user.click(await screen.findByRole("option", { name: "Member" }));

    expect(
      await screen.findByText(
        "An organization needs at least one owner. Make someone else an owner first.",
      ),
    ).toBeInTheDocument();
  });

  it("refuses the last owner's departure, in the same words", async () => {
    const user = userEvent.setup();

    renderApp({
      initialPath: `${teamPath}/settings/members`,
      store: authenticated(),
    });

    await user.click(await screen.findByRole("button", { name: "Leave" }));

    // Scoped to the dialog: the row's control and the confirmation carry the
    // same word, and a bare query would find whichever came first in the DOM.
    const dialog = within(await screen.findByRole("alertdialog"));

    await user.click(dialog.getByRole("button", { name: "Leave" }));

    expect(
      await screen.findByText(
        "An organization needs at least one owner. Make someone else an owner first.",
      ),
    ).toBeInTheDocument();

    // The dialog stays open on a refusal — closing is `onSuccess`'s — so the
    // sentence and the control that produced it are on screen together.
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("renders a refused membership write under impersonation in the catalogue's words", async () => {
    const user = userEvent.setup();

    /*
     * ADR-0067 §8's grown exclusion list, carried onto a membership write from
     * the received-invitation one it was first proved on (`D15.5`): an operator
     * acting as a customer must not be able to reshape that account's tenants.
     * Nothing on this screen hides the control — the refusal is the API's and
     * arrives as a code — so what this asserts is the half the client owns: the
     * code becomes the catalogue's sentence and never the API's `error.message`
     * (ADR-0013).
     */
    server.use(
      http.delete(`${API}/orgs/:organizationId/members/:userId`, () =>
        fail(403, "AUTH_IMPERSONATION_REFUSED"),
      ),
    );

    renderApp({
      initialPath: `${teamPath}/settings/members`,
      store: authenticated(),
    });

    await screen.findByRole("cell", { name: "morgan@machxi.local" });

    await user.click(screen.getByRole("button", { name: "Remove" }));

    const dialog = within(await screen.findByRole("alertdialog"));

    await user.click(dialog.getByRole("button", { name: "Remove" }));

    expect(
      await screen.findByText(
        "That cannot be done while impersonating this account. The account holder has to do it themselves.",
      ),
    ).toBeInTheDocument();
  });

  it("offers a member the sections but not the writes", async () => {
    /*
     * **Which cards render is the caller's role**, and the sections themselves
     * are not: a nav item that appeared and disappeared with a role would make a
     * shared link land on a not-found for one colleague and a screen for
     * another, so a member sees three sections and is told, on two of them, that
     * the writes are somebody else's. The API is still the authority — every one
     * of these operations is a guard on its route (ADR-0055 §3).
     */
    state.organizations = state.organizations.map((row) =>
      row.slug === TEAM_ORGANIZATION.slug ? { ...row, role: "member" } : row,
    );

    renderApp({
      initialPath: `${teamPath}/settings/general`,
      store: authenticated(),
    });

    expect(
      await screen.findByText("Only an owner or an admin can change this."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();

    // The nav is still all three, which is the claim above.
    for (const section of ["General", "Members", "Invitations"])
      expect(screen.getByRole("link", { name: section })).toBeInTheDocument();
  });

  it("offers an admin no deletion", async () => {
    /*
     * Deletion is an owner's and is never delegated (ADR-0067 §2), which the
     * second team's fixture exists to make assertable: the caller is an `admin`
     * there, so the details form renders and the danger card does not.
     */
    renderApp({
      initialPath: `/orgs/${SECOND_TEAM_ORGANIZATION.slug}/settings/general`,
      store: authenticated(),
    });

    expect(await screen.findByLabelText("Name")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
  });
});

describe("addresses that name nothing", () => {
  it("renders not-found for a slug outside the caller's memberships, without asking about it", async () => {
    const { router } = renderApp({
      initialPath: "/orgs/somebody-elses-tenant",
      store: authenticated(),
    });

    /*
     * `errors:ROUTE_NOT_FOUND`, which is what an unmatched path renders too —
     * because that is what this is: an address naming nothing this account can
     * see. ADR-0067 §4 refuses a non-member with `404` rather than `403` so the
     * existence of a tenant is not leaked, and the client says even less.
     */
    expect(
      await screen.findByText("That address does not exist."),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/orgs/somebody-elses-tenant");

    /*
     * The claim the plan makes by name: **no organization request**. The
     * switcher's own `GET /user/orgs` is the list the slug was resolved
     * against and is expected; anything addressed *at* an organization would
     * mean the client asked the API about a tenant it had no business naming,
     * and the timing of that answer would say whether it exists.
     */
    expect(organizationRequests()).toEqual([]);
  });

  it("renders not-found at the personal organization's own address", async () => {
    /*
     * **Only a team is addressed** (ADR-0067 §6's third bullet). The row is in
     * the caller's own list, so this is not the unknown-slug case above: the
     * private context lives at the root, and a derived slug in the address bar
     * is precisely what the amendment removes.
     */
    renderApp({
      initialPath: `/orgs/${PERSONAL_ORGANIZATION.slug}`,
      store: authenticated(),
    });

    expect(
      await screen.findByText("That address does not exist."),
    ).toBeInTheDocument();
    expect(organizationRequests()).toEqual([]);
  });

  it("renders not-found under the personal organization's settings too", async () => {
    // "and anything under it" — a personal organization has no settings surface
    // at all, so the area's sections are unreachable rather than empty.
    renderApp({
      initialPath: `/orgs/${PERSONAL_ORGANIZATION.slug}/settings/general`,
      store: authenticated(),
    });

    expect(
      await screen.findByText("That address does not exist."),
    ).toBeInTheDocument();
    expect(organizationRequests()).toEqual([]);
  });
});
