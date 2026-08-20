import type { StaffResource, StaffRole } from "@repo/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { staffResourceConfig } from "@/entities/staff";
import { userResourceConfig } from "@/entities/user";
import { gridStorageKey } from "@/shared/grid/preferences";
import { fail } from "@/test/msw/handlers/envelope";
import { API } from "@/test/msw/handlers/auth.handlers";
import {
  createSessionStore,
  type SessionStore,
} from "@/shared/api/session-store";
import {
  STAFF_ROWS,
  createStaffHandlers,
  createStaffMockState,
  type StaffMockState,
} from "@/test/msw/handlers/staff.handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";
import { staffPrincipal } from "@/test/principals";

/**
 * The staff screen end to end (`D3.7`; ADR-0034, ADR-0035, ADR-0036).
 *
 * Mounted through the **real route tree** on a memory history, so what is under
 * test includes the things a hand-built tree would quietly replace: the
 * `_dashboard` guard, `validateSearch` on `/staff`, and the round trip where a
 * control writes the URL, the URL becomes the query key, and the refetched page
 * renders. That loop is the whole of ADR-0034's "list state lives in the URL",
 * and it is only true if every link in it holds.
 *
 * The assertions are about *requests*, not about re-sorted rows: the grid never
 * sorts what it holds (ADR-0035 §The grid half), so the evidence that a header
 * click worked is the query the server was asked, which is what the handler
 * records.
 */

/**
 * A signed-in operator, parameterised by role since `D4.3` (ADR-0042).
 *
 * `admin` is the default because it is what every assertion below assumed
 * before the policy table existed, and `super_admin` would be the wrong default
 * for exactly the reason it is convenient: it bypasses the table on the one line
 * in `can` that says so, and would therefore prove nothing about it.
 */
const authenticated = (
  roles: readonly StaffRole[] = ["admin"],
): SessionStore => {
  const store = createSessionStore();

  store.setSession({
    accessToken: "test-access-token",
    principal: staffPrincipal(roles),
  });

  return store;
};

let state: StaffMockState;

const openStaff = (
  rows: readonly StaffResource[] = STAFF_ROWS,
  roles: readonly StaffRole[] = ["admin"],
) => {
  state = createStaffMockState(rows);
  server.use(...createStaffHandlers(state));

  return renderApp({ initialPath: "/staff", store: authenticated(roles) });
};

/** The last query the API was actually asked for. */
const lastList = () => state.seen.list.at(-1);

beforeEach(() => {
  server.use(...createStaffHandlers(createStaffMockState()));
  /*
   * The grid preferences of `D4.5` are real `localStorage` here, because these
   * screens exercise the *wiring* — `gridId={staffResourceConfig.name}` — not
   * the store, which has its own suite over the in-memory adapter. Clearing
   * between tests is what stops one case handing its column arrangement to the
   * next and making this file's result depend on its order.
   */
  window.localStorage.clear();
});

describe("grid preferences, through the real wiring", () => {
  /*
   * The store's own behaviour is covered against an in-memory adapter in
   * `shared/grid/__tests__/preferences.test.ts`. What only a screen can show is
   * that the two resources declare *different* `gridId`s and therefore keep
   * separate entries — the plan's "`staff` and `users` prove isolation" — and
   * that the id reaching the store is the resource's own name rather than a
   * constant somebody typed twice.
   */
  it("persists one resource's columns across a reload without touching the other's", async () => {
    const user = userEvent.setup();

    const first = openStaff();

    await screen.findByRole("cell", { name: "ada@machxi.local" });

    await user.click(screen.getByRole("button", { name: "Columns" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("checkbox", {
        name: "Roles",
      }),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("columnheader", { name: "Roles" }),
      ).not.toBeInTheDocument();
    });

    /*
     * Close the menu before unmounting. An operator would, and a test that does
     * not leaves a Radix overlay mounted at teardown — its dismiss layer and
     * focus guards keep mutating the document, and every `findBy*` in every
     * later test in this file then re-scans a tree that never settles. It cost
     * one test in this file six hundred seconds before it was noticed.
     */
    await user.keyboard("{Escape}");

    // A remount is what a reload is, and the arrangement comes back.
    first.unmount();
    openStaff();

    await screen.findByRole("cell", { name: "ada@machxi.local" });
    expect(
      screen.queryByRole("columnheader", { name: "Roles" }),
    ).not.toBeInTheDocument();

    /*
     * And the entry is the staff grid's alone.
     *
     * Both keys are built with `gridStorageKey` from the resource's own
     * `name`, never typed out. The first version hand-wrote
     * `machxi.admin.grid:users:v1` — and `userResourceConfig.name` is `"user"`
     * — so it asserted that a key nothing has ever written is absent. A
     * negative control that cannot fail is worse than none, because it reads
     * like cover.
     */
    expect(
      window.localStorage.getItem(gridStorageKey(staffResourceConfig.name)),
    ).not.toBeNull();
    expect(
      window.localStorage.getItem(gridStorageKey(userResourceConfig.name)),
    ).toBeNull();
  });
});

describe("the staff grid", () => {
  it("renders the columns the config declares and the rows the API sent", async () => {
    openStaff();

    expect(
      await screen.findByRole("cell", { name: "ada@machxi.local" }),
    ).toBeInTheDocument();

    // One `columnheader` per column, and since `D4.4` that is simply because
    // the header has one row: ADR-0039 deleted the filter row, and with it the
    // `td`-in-a-`thead` patch D3.6 needed to keep this count honest.
    const headers = screen
      .getAllByRole("columnheader")
      .map((header) => header.textContent);

    expect(headers).toEqual([
      /*
       * The checkbox column, first and unlabelled, because `grid.selectable` is
       * declared (ADR-0038). It is `AppGrid`'s and not the config's: nothing
       * else in a `ColumnConfigMap` is positional, and a declared one would let
       * the capability and the column disagree. Its header holds a control
       * rather than a name, so the text is empty and the accessible name is on
       * the checkbox.
       */
      "",
      "Email",
      "First name",
      "Last name",
      "Roles",
      "Status",
      "Last login",
      "Created",
      "Actions",
    ]);

    /*
     * The registry's renderers, resolved from config keys: `rolesList` and
     * `statusBadge` on values `shared/grid` knows nothing about.
     *
     * Scoped to the table since `D4.4`, and the reason is the feature rather
     * than the test: ADR-0039's hot filters put a "Disabled" button in the
     * toolbar, so the word is now on screen twice — once as a stance an
     * operator can press, once as a badge on a row. Only the second is what
     * this test is about.
     */
    const table = within(screen.getByRole("table"));

    expect(table.getByText("Super admin")).toBeInTheDocument();
    expect(table.getByText("Disabled")).toBeInTheDocument();
  });

  it("offers a filter icon only where the contract allow-lists one", async () => {
    openStaff();

    await screen.findByRole("cell", { name: "ada@machxi.local" });

    // Declared filterable by `listStaffQuery` …
    for (const column of ["Email", "Status", "Last login", "Created"])
      expect(
        screen.getByRole("button", { name: `Filter by ${column}` }),
      ).toBeInTheDocument();

    // … and not, because `staff_roles` is a join table. An icon here would be
    // an offer the API answers with a `VALIDATION_ERROR`.
    expect(
      screen.queryByRole("button", { name: "Filter by Roles" }),
    ).not.toBeInTheDocument();
    // Nor here: `firstName` is sortable but not in the endpoint's `filterable`
    // map at all — it is reachable through `q`.
    expect(
      screen.queryByRole("button", { name: "Filter by First name" }),
    ).not.toBeInTheDocument();

    /*
     * And the controls themselves are behind those icons rather than in a row
     * of their own (ADR-0039). This is the assertion that the width complaint
     * is actually fixed: no control occupies a header cell, so no column is
     * sized by its filter.
     */
    expect(screen.queryByPlaceholderText("Contains…")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Created from")).not.toBeInTheDocument();
  });

  it("composes a filter in its dialog and asks the server on Apply", async () => {
    const user = userEvent.setup();

    openStaff();

    await screen.findByRole("cell", { name: "ada@machxi.local" });

    await user.click(screen.getByRole("button", { name: "Filter by Email" }));

    const dialog = within(await screen.findByRole("dialog"));

    await user.type(
      dialog.getByRole("textbox", { name: "Filter by Email" }),
      "ada",
    );

    // Nothing has been asked yet — the dialog composes, Apply commits.
    expect(lastList()?.filters).toEqual([]);

    await user.click(dialog.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(lastList()?.filters).toEqual([
        { field: "email", op: "like", value: "%ada%" },
      ]);
    });

    /*
     * And the round trip closes on screen: the chip is the bar reading the URL
     * back, and the icon's name now says the column is filtered.
     */
    expect(await screen.findByText("Email contains “ada”")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Filter by Email (filtered)" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear all" }));

    /*
     * Asserted on the view rather than on a request, deliberately: clearing
     * navigates back to a query key this session already fetched, and
     * ADR-0034's 30-second `staleTime` means TanStack Query serves it from
     * cache without going near the network. "The list is unfiltered again" is
     * the observable; "the server was asked again" is not, and asserting it
     * would be asserting a cache miss.
     */
    await waitFor(() => {
      expect(
        screen.queryByText("Email contains “ada”"),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "Filter by Email" }),
    ).toBeInTheDocument();
  });

  it("presses a hot filter and asks the server for that stance", async () => {
    const user = userEvent.setup();

    openStaff();

    await screen.findByRole("cell", { name: "ada@machxi.local" });

    /*
     * `status` is the one stance this resource declares (ADR-0039). ADR-0039's
     * own example declares `roles` beside it, which `listStaffQuery` has no
     * `filterable` entry for — the config test is where that is caught, and
     * this is where the declared one is proved to reach the endpoint.
     */
    const group = within(screen.getByRole("group", { name: "Status filter" }));

    await user.click(group.getByRole("button", { name: "Disabled" }));

    await waitFor(() => {
      expect(lastList()?.filters).toEqual([
        { field: "status", op: "eq", value: "disabled" },
      ]);
    });

    // The same field's header dialog agrees, because both read the one URL.
    await user.click(
      screen.getByRole("button", { name: "Filter by Status (filtered)" }),
    );
    expect(
      within(await screen.findByRole("dialog")).getByRole("combobox", {
        name: "Filter by Status",
      }),
    ).toHaveTextContent("Disabled");
  });

  it("sorts by asking the server, not by reordering the page it holds", async () => {
    const user = userEvent.setup();

    openStaff();

    await screen.findByRole("cell", { name: "ada@machxi.local" });

    // The endpoint's default, applied because the URL said nothing.
    expect(lastList()?.sort).toEqual([
      { field: "createdAt", direction: "desc" },
    ]);

    /*
     * Named exactly, not by pattern: since `D4.4` the Email header holds two
     * buttons — the sort control and ADR-0039's filter icon — and `/Email/`
     * matches both.
     */
    await user.click(screen.getByRole("button", { name: "Email" }));

    await waitFor(() => {
      expect(lastList()?.sort).toEqual([{ field: "email", direction: "asc" }]);
    });
  });

  it("searches through the toolbar, because `q` belongs to the endpoint", async () => {
    const user = userEvent.setup();

    openStaff();

    await screen.findByRole("cell", { name: "ada@machxi.local" });

    await user.type(screen.getByRole("searchbox"), "eve");

    // Debounced: one request for the term, not one per keystroke.
    await waitFor(
      () => {
        expect(lastList()?.q).toBe("eve");
      },
      { timeout: 2000 },
    );
    expect(
      await screen.findByRole("cell", { name: "eve@machxi.local" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("cell", { name: "ada@machxi.local" }),
    ).not.toBeInTheDocument();
  });

  it("says so when the list is refused, instead of loading forever", async () => {
    const user = userEvent.setup();

    /*
     * The failure ADR-0034 premises silent queries on having somewhere to show
     * themselves. `AppGrid` used to render its loading rows whenever it had no
     * page, and the retry policy short-circuits a `4xx` — so an `editor` who
     * reached this route, or a role revoked mid-session, met five skeleton rows
     * that never resolved and no message anywhere.
     */
    state = createStaffMockState();
    let refused = true;

    server.use(
      // Returning `undefined` is MSW's "not mine" — so once the flag flips, the
      // request falls through to the working handlers behind this one and the
      // retry is a real recovery rather than a second mock.
      http.get(`${API}/staff`, () =>
        refused ? fail(403, "FORBIDDEN") : undefined,
      ),
      ...createStaffHandlers(state),
    );

    renderApp({ initialPath: "/staff", store: authenticated() });

    expect(
      await screen.findByText("You do not have permission to do that."),
    ).toBeInTheDocument();

    // And the panel offers another attempt rather than only an apology.
    refused = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("cell", { name: "ada@machxi.local" }),
    ).toBeInTheDocument();
  });

  it("pages from the real total the envelope carries", async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: 25 }, (_, index) => ({
      ...(STAFF_ROWS[0] as StaffResource),
      id: `0198c1f0-0000-7000-8000-${String(index).padStart(12, "0")}`,
      email: `operator-${String(index).padStart(2, "0")}@machxi.local`,
    }));

    openStaff(rows);

    await screen.findByRole("cell", { name: "operator-00@machxi.local" });
    // "1–20 of 25" — a genuine filtered count (ADR-0012), not "page 1 of 1".
    expect(screen.getByText("1–20 of 25")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() => {
      expect(lastList()?.offset).toBe(20);
    });
    expect(await screen.findByText("21–25 of 25")).toBeInTheDocument();
  });
});

describe("the staff screen's actions", () => {
  it("reaches the create surface through the URL, not through page state", async () => {
    const user = userEvent.setup();

    openStaff();

    await screen.findByRole("cell", { name: "ada@machxi.local" });

    /*
     * A **link**, since `D4.2` (ADR-0040): composing a record is addressable
     * state, so the entry point is a navigation. The role is the assertion — a
     * `button` here would mean the surface went back to being page state that
     * a reload and the Back button cannot see.
     */
    await user.click(screen.getByRole("link", { name: "New staff member" }));

    expect(
      await screen.findByRole("heading", { name: "New staff member" }),
    ).toBeInTheDocument();
    /*
     * The grid is still mounted underneath — `staff` declares a dialog, and a dialog
     * overlays the list rather than replacing it.
     *
     * `hidden: true` because Radix marks the rest of the document
     * `aria-hidden` while an overlay is open, so the default role query
     * correctly cannot see these rows. That is the shell behaving; the
     * assertion is that the rows are still *there*, and Testing Library has an
     * option for exactly this question rather than a reason to drop to the DOM.
     */
    expect(screen.getAllByRole("row", { hidden: true }).length).toBeGreaterThan(
      1,
    );
  });

  it("reaches every row action from a menu named for its row", async () => {
    const user = userEvent.setup();
    const target = STAFF_ROWS[1] as StaffResource;

    openStaff();

    await screen.findByRole("cell", { name: "ada@machxi.local" });

    /*
     * Named for the row rather than "Row actions" twenty times over — which is
     * the role-and-label discipline earning its keep, and what lets this test
     * name a row instead of indexing into one.
     */
    await user.click(
      screen.getByRole("button", { name: `Row actions for ${target.id}` }),
    );

    const menu = await screen.findByRole("menu");

    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Edit",
      "Reset password",
      "Sign out everywhere",
      // Destructive last, wherever the feature declared it.
      "Delete",
    ]);

    await user.click(within(menu).getByRole("menuitem", { name: "Edit" }));

    expect(
      await screen.findByRole("heading", { name: `Edit ${target.email}` }),
    ).toBeInTheDocument();
  });

  it("refreshes the grid after a write, because the mutation invalidated the list", async () => {
    const user = userEvent.setup();
    const target = STAFF_ROWS[1] as StaffResource;

    openStaff();

    await screen.findByRole("cell", { name: "ada@machxi.local" });

    await user.click(
      screen.getByRole("button", { name: `Row actions for ${target.id}` }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Delete",
      }),
    );

    // The row is gone from the screen because `lists()` was invalidated and the
    // grid refetched — not because anything removed it locally (ADR-0034).
    await waitFor(() => {
      expect(
        screen.queryByRole("cell", { name: target.email }),
      ).not.toBeInTheDocument();
    });
    expect(state.seen.list.length).toBeGreaterThan(1);
  });
});

/**
 * Selection and the bulk fan-out, through the real screen (`D4.3`, ADR-0038).
 *
 * The grid suite already proves the machinery against the demo config; what is
 * here is what only a real screen can show — a selection surviving a *real*
 * page change (a navigation, a new query key, a refetch, not a `rerender`), and
 * a fan-out whose refusals are the ones ADR-0028 actually produces.
 */
describe("the staff screen's selection and bulk delete", () => {
  it("keeps a selection across a page change, because it is keyed by id", async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: 25 }, (_, index) => ({
      ...(STAFF_ROWS[0] as StaffResource),
      id: `0198c1f0-0000-7000-8000-${String(index).padStart(12, "0")}`,
      email: `operator-${String(index).padStart(2, "0")}@machxi.local`,
    }));
    const first = rows[0] as StaffResource;

    openStaff(rows);

    await screen.findByRole("cell", { name: first.email });

    await user.click(
      screen.getByRole("checkbox", { name: `Select ${first.id}` }),
    );
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next page" }));

    /*
     * A genuine page change: the URL moved, the query key with it, and the
     * server answered with rows that do not include the selected one. The count
     * still reads 1 because selection describes *rows* — `getRowId` is the
     * resource's own id — rather than positions in whatever page is in hand.
     * The row is off screen and still staged, which is exactly why the count
     * says "1 selected" and not "1 on this page".
     */
    expect(await screen.findByText("21–25 of 25")).toBeInTheDocument();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("reports both outcomes of a mixed bulk delete, and refetches once", async () => {
    const user = userEvent.setup();
    const [ada, mo] = STAFF_ROWS;

    if (ada === undefined || mo === undefined)
      throw new Error("fixture missing");

    openStaff();

    /*
     * The refusal ADR-0028 rule 2 exists for, scripted rather than described:
     * the last active super admin cannot be deleted, and the service answers
     * `409 STAFF_LAST_SUPER_ADMIN` for *that* row while the others are
     * legitimate. Returning `undefined` for everyone else is MSW's "not mine",
     * so the working handler behind this one does the real delete.
     */
    server.use(
      http.delete(`${API}/staff/:id`, ({ params }) =>
        params["id"] === ada.id
          ? fail(409, "STAFF_LAST_SUPER_ADMIN")
          : undefined,
      ),
    );

    await screen.findByRole("cell", { name: ada.email });
    const listsBefore = state.seen.list.length;

    await user.click(
      screen.getByRole("checkbox", { name: `Select ${ada.id}` }),
    );
    await user.click(screen.getByRole("checkbox", { name: `Select ${mo.id}` }));

    await user.click(screen.getByRole("button", { name: "Delete 2" }));

    const confirm = await screen.findByRole("alertdialog");
    expect(
      within(confirm).getByRole("heading", {
        name: "Delete 2 staff accounts?",
      }),
    ).toBeInTheDocument();

    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    /*
     * One summary for the whole batch, both outcomes in it, and the refusal
     * named per item with the sentence the ADR-0034 map wrote for that code —
     * never the API's own `message`. This is the semantic a transactional bulk
     * endpoint could not have given: eight lawful deletions are not rolled back
     * because a ninth was refused.
     */
    expect(
      await screen.findByText("1 deleted, 1 refused."),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        `${ada.email}: This is the last super admin. Promote someone else first.`,
      ),
    ).toBeInTheDocument();

    // The refused row is still there, and the toast says why it remains.
    expect(
      await screen.findByRole("cell", { name: ada.email }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.queryByRole("cell", { name: mo.email }),
      ).not.toBeInTheDocument();
    });

    // Two requests, one invalidation: the fan-out calls the plain API functions
    // rather than N mutation hooks, so the list refetches once at the end
    // instead of once per row (ADR-0038).
    // Only `mo` reaches the real handler — the scripted refusal answers for
    // `ada` before it — which is the fan-out's point: the refused row's failure
    // is its own and does not stop the others.
    expect(state.seen.deleted).toEqual([mo.id]);
    expect(state.seen.list.length).toBe(listsBefore + 1);

    // And the selection ends with the fan-out — `clearSelection` travelled with
    // the action because the state that holds it lives inside `AppGrid`.
    await waitFor(() => {
      expect(screen.queryByText(/selected/)).toBeNull();
    });
  });
});
