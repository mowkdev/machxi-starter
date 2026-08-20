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

/**
 * The users screen end to end (`D3.8`; ADR-0028, ADR-0034, ADR-0035).
 *
 * The staff page suite already proves the grid loop — headers sort by asking
 * the server, the pager reads a real total, the URL is the state. Repeating it
 * would test D3.6 twice. What is asserted here is the behaviour that is this
 * resource's alone, and every piece of it comes from ADR-0028's soft delete:
 * deleted accounts are hidden by default, the "Deleted only" checkbox is a
 * scope switch written into the URL like any other filter, and a deleted
 * account is **kept and marked** rather than removed.
 */

const authenticated = (): SessionStore => {
  const store = createSessionStore();

  store.setSession({ accessToken: "test-access-token" });

  return store;
};

const [CARA, , GONE] = USER_ROWS;

if (CARA === undefined || GONE === undefined)
  throw new Error("fixture missing");

let state: UsersMockState;

const openUsers = () => {
  state = createUsersMockState();
  server.use(...createUsersHandlers(state));

  return renderApp({ initialPath: "/users", store: authenticated() });
};

const lastList = () => state.seen.list.at(-1);

beforeEach(() => {
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

    await user.click(screen.getByRole("checkbox", { name: "Deleted only" }));

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

    await user.click(screen.getByRole("checkbox", { name: "Deleted only" }));

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
     * The grid is still mounted underneath — a drawer's whole argument over a modal is
     * that the list stays on screen beside it.
     *
     * Queried through the DOM rather than by role, and that is the modal doing
     * its job: Radix marks the rest of the document `aria-hidden` while an
     * overlay is open, so `getByRole` correctly cannot see the rows. Their
     * being *there* is what this asserts; their being unreachable is the
     * intended behaviour of the shell on top of them.
     */
    expect(document.querySelector('[data-slot="table"]')).not.toBeNull();
  });
});
