import type { StaffRole } from "@repo/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createSessionStore,
  type SessionStore,
} from "@/shared/api/session-store";
import { server } from "@/test/msw/server";
import {
  USER_ROWS,
  createUsersHandlers,
  createUsersMockState,
  type UsersMockState,
} from "@/test/msw/handlers/users.handlers";
import { renderApp } from "@/test/render";
import { staffPrincipal } from "@/test/principals";

/**
 * The users screen end to end (`D3.8`; ADR-0028, ADR-0034, ADR-0035).
 *
 * The staff page suite already proves the grid loop — headers sort by asking
 * the server, the pager reads a real total, the URL is the state. Repeating it
 * would test D3.6 twice. What is asserted here is the behaviour that is this
 * resource's alone, and every piece of it comes from ADR-0028's soft delete:
 * deleted accounts are hidden by default, the "Deleted only" toggle is a
 * scope switch written into the URL like any other filter, and a deleted
 * account is **kept and marked** rather than removed.
 */

/**
 * A signed-in operator, parameterised by role since `D4.3` (ADR-0042).
 *
 * This resource is the one the parameter was added for: `/admin/users` mounts
 * `authorize("admin", "manager")` and refines its five writes back to `admin`,
 * so an `admin` and a `manager` are offered genuinely different screens — which
 * is the D3.8 defect and the assertion that closes it.
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

const [CARA, , GONE] = USER_ROWS;

if (CARA === undefined || GONE === undefined)
  throw new Error("fixture missing");

let state: UsersMockState;

const openUsers = (roles: readonly StaffRole[] = ["admin"]) => {
  state = createUsersMockState();
  server.use(...createUsersHandlers(state));

  return renderApp({ initialPath: "/users", store: authenticated(roles) });
};

const lastList = () => state.seen.list.at(-1);

beforeEach(() => {
  /*
   * This screen's grid persists its columns to real `localStorage` under
   * `machxi.admin.grid:users:v1` (`D4.5`). No case below touches the Columns
   * menu, so nothing is written today — the clear is here so that the first one
   * that does cannot hand its arrangement to the next test and make this file's
   * result depend on its order.
   */
  window.localStorage.clear();

  server.use(...createUsersHandlers(createUsersMockState()));
});

describe("the users grid", () => {
  it("renders the columns the config declares, including the deleted marker", async () => {
    openUsers();

    expect(
      await screen.findByRole("cell", { name: CARA.email }),
    ).toBeInTheDocument();

    const headers = screen
      .getAllByRole("columnheader")
      .map((header) => header.textContent);

    expect(headers).toEqual([
      // The checkbox column `grid.selectable` adds (ADR-0038), unlabelled
      // because its header holds a control rather than a name.
      "",
      "Email",
      "First name",
      "Last name",
      "Roles",
      "Status",
      "Last login",
      "Created",
      // The mark ADR-0028's read path needs: `status` alone cannot tell a
      // disabled account from a deleted one, because `USER_STATUSES` has no
      // `deleted` member on purpose.
      "Deleted",
      "Actions",
    ]);
  });

  it("renders a null name as a dash, not as the string null", async () => {
    openUsers();

    await screen.findByRole("cell", { name: CARA.email });

    // `users.first_name` is nullable (ADR-0017), and a blank cell reads as a
    // rendering failure — the `text` formatter's en dash says "nothing here".
    expect(
      await screen.findByRole("cell", { name: "pat@example.test" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("cell", { name: "—" }).length).toBeGreaterThan(
      0,
    );
  });

  it("switches scope between live and deleted accounts", async () => {
    const user = userEvent.setup();

    openUsers();

    await screen.findByRole("cell", { name: CARA.email });

    // The endpoint's default scope: no opinion in the query means live only.
    expect(lastList()?.filters).toEqual([]);
    expect(
      screen.queryByRole("cell", { name: GONE.email }),
    ).not.toBeInTheDocument();

    /*
     * A **hot filter** since `D4.4` (ADR-0039), and the first `presence` one:
     * this is the definition of a stance — pressed and released many times a
     * session — so it moved out of the deleted filter row and into the toolbar
     * as a toggle button rather than a checkbox buried among six header cells.
     */
    await user.click(screen.getByRole("button", { name: "Deleted only" }));

    /*
     * `filter[deletedAt][null]=false` is `deleted_at is not null`, and the
     * repository's default scope steps aside as soon as the query mentions
     * `deletedAt` — so this **replaces** the live accounts rather than adding
     * to them. The control is labelled for what it does; a "Show deleted"
     * checkbox would be promising a third request the contract cannot express,
     * since `deletedAt` is allow-listed for `null` alone.
     */
    await waitFor(() => {
      expect(lastList()?.filters).toEqual([
        { field: "deletedAt", op: "null", value: false },
      ]);
    });
    expect(
      await screen.findByRole("cell", { name: GONE.email }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.queryByRole("cell", { name: CARA.email }),
      ).not.toBeInTheDocument();
    });
  });

  it("keeps a deleted account listed and marked rather than removing it", async () => {
    const user = userEvent.setup();

    openUsers();

    await screen.findByRole("cell", { name: CARA.email });

    await user.click(
      screen.getByRole("button", { name: `Row actions for ${CARA.id}` }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Delete",
      }),
    );

    await waitFor(() => {
      expect(state.seen.deleted).toEqual([CARA.id]);
    });

    /*
     * The difference from staff, in one flow. A hard delete removes the row;
     * this one keeps it — `deletedAt` set and `status` written to `disabled`
     * (ADR-0028) — so the account leaves the *live* scope but is still there to
     * be found, now carrying a date in the column that exists to say so.
     */
    await waitFor(() => {
      expect(
        screen.queryByRole("cell", { name: CARA.email }),
      ).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Deleted only" }));

    const row = await screen.findByRole("row", {
      name: new RegExp(CARA.email),
    });

    // The Deleted column is second from the right, and it is no longer the en
    // dash a live account renders.
    expect(within(row).getAllByRole("cell").at(-2)?.textContent).not.toBe("—");
  });

  it("reaches every row action from a menu named for its row", async () => {
    const user = userEvent.setup();

    openUsers();

    await screen.findByRole("cell", { name: CARA.email });

    await user.click(
      screen.getByRole("button", { name: `Row actions for ${CARA.id}` }),
    );

    const menu = await screen.findByRole("menu");

    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Edit", "Reset password", "Sign out everywhere", "Delete"]);

    await user.click(within(menu).getByRole("menuitem", { name: "Edit" }));

    expect(
      await screen.findByRole("heading", { name: `Edit ${CARA.email}` }),
    ).toBeInTheDocument();
  });

  it("reaches the create surface through the URL, and opens it in a drawer", async () => {
    const user = userEvent.setup();

    openUsers();

    await screen.findByRole("cell", { name: CARA.email });

    await user.click(screen.getByRole("link", { name: "New user" }));

    expect(
      await screen.findByRole("heading", { name: "New user" }),
    ).toBeInTheDocument();
    /*
     * The one place a suite names the shell (`D4.2`, ADR-0040): `users`
     * declares `editSurface: "drawer"` where `staff` declares a dialog, and
     * `Sheet` renders as a `dialog` role too — so what distinguishes them is
     * the `data-slot`. Everything else about this form is asserted by the
     * feature suite without knowing which frame it is inside, which is the
     * property the config switch is for.
     */
    expect(
      document.querySelector('[data-slot="sheet-content"]'),
    ).not.toBeNull();
    /*
     * The grid is still mounted underneath — a drawer's whole argument over a modal
     * is that the list stays on screen beside it.
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
});

/**
 * What a role is offered on this screen (`D4.3`, ADR-0042).
 *
 * The two tests that would have caught the D3.8 defect, and they are cheap for
 * the reason ADR-0042 predicted: the session store is a constructor parameter
 * in this harness rather than a module to mock, so rendering the same screen
 * for two principals is two calls.
 *
 * **Neither assertion is a security claim.** The API's guards remain the
 * enforcement (ADR-0019); removing or tampering with the policy table must
 * change nothing about which requests are accepted. What is asserted is which
 * affordances are *drawn*.
 */
describe("the users screen for a manager", () => {
  /** The row menu, opened on a row and read as text. */
  const menuItemsFor = async (id: string) => {
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: `Row actions for ${id}` }),
    );

    return within(await screen.findByRole("menu"))
      .getAllByRole("menuitem")
      .map((item) => item.textContent);
  };

  it("is offered neither Create nor Delete, because the router refuses both", async () => {
    openUsers(["manager"]);

    await screen.findByRole("cell", { name: CARA.email });

    /*
     * `/admin/users` mounts `authorize("admin", "manager")` — a manager may read
     * the customer base — and the router refines its five writing routes back to
     * `authorize("admin")`. So these two were affordances that could only ever
     * end in a `403`, which is the D3.8 defect this closes.
     */
    expect(screen.queryByRole("link", { name: "New user" })).toBeNull();

    // The checkbox column stays, because selectable is not a permission — the
    // bulk *button* is what goes with Delete, same endpoint and same answer.
    // Asserted before the menu opens: Radix marks the rest of the document
    // `aria-hidden` while an overlay is up.
    expect(
      screen.getByRole("checkbox", { name: `Select ${CARA.id}` }),
    ).toBeInTheDocument();

    expect(await menuItemsFor(CARA.id)).not.toContain("Delete");
  });

  it("still sees every containment control, and the server still answers them", async () => {
    openUsers(["manager"]);

    await screen.findByRole("cell", { name: CARA.email });

    /*
     * **This is the assertion that stops a later "tidy-up" from hiding them.**
     * Reset password takes a stolen credential away, Sign out everywhere ends a
     * compromised session, and the only route to `status: "disabled"` today is
     * the Edit form. A hidden control during an incident is a silent absence
     * with no error and nothing to escalate with; the `403` it would replace is
     * at worst a wasted click and at best the sentence that tells an operator to
     * go and find an admin (ADR-0042 §Containment controls).
     *
     * All three still `403`. That is deliberate, and the ADR says why.
     */
    expect(await menuItemsFor(CARA.id)).toEqual([
      "Edit",
      "Reset password",
      "Sign out everywhere",
    ]);
  });

  it("gives an admin both back", async () => {
    openUsers(["admin"]);

    await screen.findByRole("cell", { name: CARA.email });

    expect(screen.getByRole("link", { name: "New user" })).toBeInTheDocument();
    expect(await menuItemsFor(CARA.id)).toEqual([
      "Edit",
      "Reset password",
      "Sign out everywhere",
      "Delete",
    ]);
  });
});
