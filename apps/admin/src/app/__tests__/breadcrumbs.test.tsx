import {
  fireEvent,
  screen,
  waitFor,
  waitForElementToBeRemoved,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createStaffHandlers,
  createStaffMockState,
  STAFF_ROWS,
} from "@/test/msw/handlers/staff.handlers";
import { server } from "@repo/app-kit/testing";
import { renderApp } from "@/test/render";
import { authenticatedAs } from "@/test/principals";

/**
 * The breadcrumbs slot's proving screen, and the record-label channel under it
 * (`D8.6`, ADR-0048 §2).
 *
 * **Everything here is queried `{ hidden: true }`, and that is not a
 * workaround.** The record routes are where a trail means something (ADR-0044:
 * the URL carries the record), and on the `dialog` and `drawer` variants the
 * open surface is modal — Radix marks the rest of the document `aria-hidden`,
 * so the whole shell, trail included, is outside the accessibility tree while
 * the surface is open. A test that queried normally would report "no
 * breadcrumb" and be describing Radix rather than the shell.
 *
 * The ancestor click is `fireEvent`, not `user-event`, for the neighbouring
 * reason: `user-event` refuses to click inside a `pointer-events: none`
 * subtree, which is what the modal's overlay makes of everything behind it.
 * What the click proves is the thing jsdom cannot otherwise see — a shell that
 * emitted plain `href` anchors would reload the document in a browser, and the
 * observable form of "it navigated in-app instead" is that the route changed
 * while the shell stayed mounted.
 */

const [ADA, MO] = STAFF_ROWS;

if (ADA === undefined || MO === undefined) {
  throw new Error("fixture missing");
}

const open = (initialPath: string) =>
  renderApp({ initialPath, store: authenticatedAs() });

const trail = async () =>
  within(
    await screen.findByRole("navigation", { hidden: true, name: "breadcrumb" }),
  );

beforeEach(() => {
  server.use(...createStaffHandlers(createStaffMockState()));
});

describe("the shell's breadcrumb trail", () => {
  it("renders on a record route, with the ancestor above the record", async () => {
    open(`/staff/${MO.id}`);

    const crumbs = await trail();

    expect(
      crumbs.getByRole("link", { hidden: true, name: "Staff" }),
    ).toHaveAttribute("href", "/staff");
  });

  it("ends on the loaded record's own label, not on the route title", async () => {
    open(`/staff/${MO.id}`);

    const crumbs = await trail();

    /*
     * The channel end to end: `staticData.recordLabel` on the `$staffId`
     * route narrowed the loader's `unknown` to this email, `useRouteRecordLabel`
     * read it, and the last crumb rendered it. The route's own title is "Edit
     * staff member" — a different string, which is what makes this assertion
     * about the label rather than about the trail.
     */
    await waitFor(() => {
      expect(crumbs.getByText(MO.email)).toBeInTheDocument();
    });
    expect(crumbs.queryByText("Edit staff member")).not.toBeInTheDocument();
  });

  it("navigates in-app from an ancestor crumb, without remounting the shell", async () => {
    open(`/staff/${MO.id}`);

    const crumbs = await trail();
    const shellBefore = await screen.findByRole("main", { hidden: true });

    /*
     * The precondition, awaited rather than assumed. The trail is built from
     * `staticData` and appears as soon as the `$staffId` match does, so
     * without this the surface might not be open yet — and then "the dialog is
     * gone" and "the shell is the same node" would both be satisfied by the
     * click doing nothing at all, which is the opposite of what they claim.
     */
    const surface = await screen.findByRole("dialog");

    fireEvent.click(crumbs.getByRole("link", { hidden: true, name: "Staff" }));

    /*
     * The record surface closed, so the route really changed — and it is a
     * removal of *this* node, an event rather than a state. On the dialog
     * rather than on the record's email: `/staff` is the list, and the row for
     * this record carries the same address, so an assertion on the email would
     * be satisfied by the destination as readily as by the origin.
     */
    await waitForElementToBeRemoved(surface);

    /*
     * …and it is the same `main` element, which is what a full document reload
     * would not have left behind. `toBe`, on the node itself: a re-rendered
     * shell would satisfy any query that only asked whether one exists.
     */
    expect(screen.getByRole("main")).toBe(shellBefore);
  });

  it("falls back to the route title where no record label is declared", async () => {
    open("/account/profile");

    /*
     * `/account/profile` declares no `recordLabel` and no `fullHeight`, so it
     * takes the same `fullHeight === false` branch a `page`-variant record
     * route would — which is exactly why it is worth asserting. The branch
     * must be a no-op wherever nothing declares a label.
     */
    expect(
      await screen.findByRole("heading", { name: "Profile" }),
    ).toBeInTheDocument();
  });

  it("renders no trail where there is no ancestor to go back to", async () => {
    open("/");

    await screen.findByRole("heading", { name: "Dashboard" });

    /*
     * One crumb is not a trail: it repeats the `<h1>` and adds a second
     * `role="link"` named for the page, because `BreadcrumbPage` carries that
     * role. `/`, `/staff` and `/users` are single-crumb; the account area is
     * not, and stopped being the example here at `D11.9` — `/account/profile`
     * hangs off an `Account` ancestor, which is ADR-0053 §1's point.
     */
    expect(
      screen.queryByRole("navigation", { hidden: true, name: "breadcrumb" }),
    ).not.toBeInTheDocument();
  });
});
