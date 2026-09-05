import { server } from "@repo/app-kit/testing";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createSessionStore,
  type SessionStore,
} from "@/shared/api/session-store";
import { renderApp } from "@/test/render";
import {
  ORGANIZATIONS_ROWS,
  ORGANIZATION_MEMBER_ROWS,
  createOrganizationsHandlers,
  createOrganizationMockState,
  type OrganizationMockState,
} from "@/test/msw/handlers/organizations.handlers";
import { staffPrincipal } from "@/test/principals";

import type { StaffRole } from "@repo/contracts";

/**
 * The organizations screen end to end (ADR-0034, ADR-0035, ADR-0036).
 *
 * Mounted through the **real route tree** on a memory history, so what is under
 * test includes the things a hand-built tree would quietly replace: the
 * `_dashboard` guard, `validateSearch` on the list route, and the round trip
 * where a control writes the URL, the URL becomes the query key, and the
 * refetched page renders.
 *
 * The assertions are about *requests*, not about re-sorted rows: the grid never
 * sorts what it holds (ADR-0035 §The grid half), so the evidence that a control
 * worked is the query the server was asked, which is what the handler records.
 *
 * **This is the floor, not the ceiling.** Add the cases this resource's own
 * behaviour earns — a refusal it can meet, a filter an operator lives in, a
 * field the form must not send.
 */

/**
 * The seeded rows, narrowed once and at the top.
 *
 * `ORGANIZATIONS_ROWS[0]` is `T | undefined` under
 * `noUncheckedIndexedAccess`, and an assertion written against `?.name` would
 * pass against `undefined` — which is a test that cannot fail. They are
 * narrowed **above** the helpers rather than beside the cases, because
 * `openRecord` builds a path out of one and a guard below it narrows nothing.
 */
const FIRST_ROW = ORGANIZATIONS_ROWS[0];
/** The `team` fixture, which is the one the members section hangs off. */
const TEAM_ROW = ORGANIZATIONS_ROWS.find((row) => row.kind === "team");
const [OWNER_MEMBER, PLAIN_MEMBER] = ORGANIZATION_MEMBER_ROWS;

if (
  FIRST_ROW === undefined ||
  TEAM_ROW === undefined ||
  OWNER_MEMBER === undefined ||
  PLAIN_MEMBER === undefined
)
  throw new Error("the mock fixtures are incomplete");

const authenticated = (...roles: readonly StaffRole[]): SessionStore => {
  const store = createSessionStore();

  store.setSession({
    accessToken: "test-access-token",
    principal: staffPrincipal(roles.length === 0 ? ["admin"] : roles),
  });

  return store;
};

let state: OrganizationMockState;

const openOrganizations = (...roles: readonly StaffRole[]) => {
  state = createOrganizationMockState();
  server.use(...createOrganizationsHandlers(state));

  return renderApp({
    initialPath: "/organizations",
    store: authenticated(...roles),
  });
};

/** The record page, which is where the members section lives (`D15.4`). */
const openRecord = (...roles: readonly StaffRole[]) => {
  state = createOrganizationMockState();
  server.use(...createOrganizationsHandlers(state));

  return renderApp({
    initialPath: `/organizations/${TEAM_ROW.id}`,
    store: authenticated(...roles),
  });
};

/** The last query the API was actually asked for. */
const lastList = () => state.seen.list.at(-1);

/**
 * The row menu's items, by their text.
 *
 * The users screen's helper, and it is here for the reason that one exists:
 * row Delete is a `menuitem` inside a closed dropdown, so
 * `queryByRole("button", { name: "Delete" })` finds nothing **for any role**
 * and asserts nothing at all (`D15.4`'s review caught exactly that).
 */
const menuItemsFor = async (id: string) => {
  const user = userEvent.setup();

  await user.click(
    screen.getByRole("button", { name: `Row actions for ${id}` }),
  );

  return within(await screen.findByRole("menu"))
    .getAllByRole("menuitem")
    .map((item) => item.textContent);
};

beforeEach(() => {
  server.use(...createOrganizationsHandlers(createOrganizationMockState()));
  window.localStorage.clear();
});

describe("the organizations screen", () => {
  it("renders the page the endpoint answered", async () => {
    openOrganizations();

    expect(
      await screen.findByRole("cell", { name: FIRST_ROW.name }),
    ).toBeInTheDocument();
  });

  it("puts the search term on the wire as `q` (ADR-0014)", async () => {
    const user = userEvent.setup();

    openOrganizations();

    await screen.findByRole("cell", { name: FIRST_ROW.name });

    await user.type(screen.getByRole("searchbox"), FIRST_ROW.name);

    // Debounced: one request for the term, not one per keystroke.
    await waitFor(
      () => {
        expect(lastList()?.q).toBe(FIRST_ROW.name);
      },
      { timeout: 2000 },
    );
  });

  /* ── the policy row on the wire (ADR-0042) ─────────────────────────────── */

  it("offers an admin the Create control", async () => {
    // The pattern the users screen established, extended to the tenant base:
    // the config declares a Create and a Delete, `RESOURCE_POLICY` says a
    // manager has neither, and `useAllowedCapabilities` conjoins the two. The
    // API's guards remain the enforcement; this is what stops the app offering
    // a control it knows will be refused.
    openOrganizations("admin");

    expect(
      await screen.findByRole("link", { name: "New organization" }),
    ).toBeInTheDocument();
  });

  it("offers a manager neither Create nor Delete", async () => {
    // A separate test rather than a second render in the one above: two
    // `renderApp` calls leave two trees mounted, and the assertion would find
    // the first one's control and pass for the wrong reason.
    openOrganizations("manager");

    await screen.findByRole("cell", { name: FIRST_ROW.name });

    expect(screen.queryByRole("link", { name: "New organization" })).toBeNull();
    // In the **row menu**, which is where Delete lives — and with the positive
    // control below, so this cannot be a query that finds nothing either way.
    expect(await menuItemsFor(FIRST_ROW.id)).not.toContain("Delete");
  });

  it("offers an admin the row Delete the manager was refused", async () => {
    // The positive control for the assertion above. Without it, a Delete that
    // stopped rendering for everybody would leave that test green.
    openOrganizations("admin");

    await screen.findByRole("cell", { name: FIRST_ROW.name });

    expect(await menuItemsFor(FIRST_ROW.id)).toContain("Delete");
  });

  /* ── the members section (ADR-0067 §3, `D15.4`) ────────────────────────── */

  describe("the members section", () => {
    it("lists the organization's members", async () => {
      openRecord();

      expect(
        await screen.findByRole("cell", { name: OWNER_MEMBER.email }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("cell", { name: PLAIN_MEMBER.email }),
      ).toBeInTheDocument();
    });

    it("adds a member by user id", async () => {
      const user = userEvent.setup();

      openRecord();

      await screen.findByRole("cell", { name: OWNER_MEMBER.email });
      await user.click(screen.getByRole("button", { name: "Add member" }));

      const joinerId = "0198c1f0-0000-7000-8000-00000000f009";

      await user.type(screen.getByLabelText("Account id"), joinerId);
      await user.click(screen.getByRole("button", { name: "Add" }));

      // **By user id, not by address** (ADR-0067 §3) — the assertion is about
      // what reached the wire, which is where the decision lives.
      await waitFor(() => {
        expect(state.seen.membersAdded.at(-1)).toEqual({
          organizationId: TEAM_ROW.id,
          body: { userId: joinerId, role: "member" },
        });
      });
    });

    it("changes a member's role", async () => {
      const user = userEvent.setup();

      openRecord();

      await screen.findByRole("cell", { name: PLAIN_MEMBER.email });

      const selects = screen.getAllByRole("combobox", {
        name: "Change role",
      });
      const target = selects.at(-1);

      if (target === undefined) throw new Error("no role control rendered");

      await user.click(target);
      await user.click(await screen.findByRole("option", { name: "Admin" }));

      // **Which** member, not just which role: a section that targeted the
      // wrong row would otherwise pass this (`D15.4`'s review).
      await waitFor(() => {
        expect(state.seen.memberRoles.at(-1)).toEqual({
          organizationId: TEAM_ROW.id,
          userId: PLAIN_MEMBER.userId,
          role: "admin",
        });
      });
    });

    it("removes a member behind a confirmation", async () => {
      const user = userEvent.setup();

      openRecord();

      await screen.findByRole("cell", { name: PLAIN_MEMBER.email });

      const removes = screen.getAllByRole("button", { name: "Remove" });
      const target = removes.at(-1);

      if (target === undefined) throw new Error("no remove control rendered");

      await user.click(target);
      // The confirmation is the second `Remove`, in the alert dialog — a
      // destructive act does not happen on one press (ADR-0044).
      await user.click(await screen.findByRole("button", { name: "Remove" }));

      await waitFor(() => {
        expect(state.seen.membersRemoved.at(-1)).toEqual({
          organizationId: TEAM_ROW.id,
          userId: PLAIN_MEMBER.userId,
        });
      });
    });

    it("shows a manager the members and none of the three writes", async () => {
      openRecord("manager");

      expect(
        await screen.findByRole("cell", { name: OWNER_MEMBER.email }),
      ).toBeInTheDocument();

      // The sub-resource's routes carry the same `authorize("admin")` as the
      // resource's writes, which is why one policy key gates all three
      // (ADR-0042, ADR-0067 §3).
      expect(
        screen.queryByRole("button", { name: "Add member" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Remove" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("combobox", { name: "Change role" }),
      ).not.toBeInTheDocument();
    });
  });
});
