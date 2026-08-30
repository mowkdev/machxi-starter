import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createProfileHandlers,
  createProfileMockState,
} from "@/test/msw/handlers/profile.handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";
import { authenticatedAs } from "@/test/principals";

/**
 * The account menu's mount point, asserted through the real route tree
 * (`D8.5`, ADR-0049 §The-shell-adapter).
 *
 * Four shipped assertions already reach this control — `pages/account`'s three
 * and `features/auth`'s logout — and all four go on reaching it by accessible
 * name, which is the point: the menu's *contents* did not move, only where it
 * hangs. What only this file claims is the move itself, in the two directions
 * that can each be wrong on their own: the trigger is in the header, and the
 * region it used to hang in holds no trace of it (`D11.3` narrowed that from
 * "the region is gone", which stopped being true when the version footer
 * gave the region a job).
 *
 * **And since `D11.10`, what the menu holds** (ADR-0053 §2). That claim is
 * here rather than in the widget's own suite for the reason the mount is: the
 * inventory is only meaningful against the real tree, where a section left
 * behind would still render.
 *
 * Mounted through `renderApp` rather than by rendering the widget, because the
 * hand-off is the thing under test: `app-sidebar` exports the menu, the
 * `_dashboard` route file composes it, and `dashboard-layout` places it into
 * `headerEnd` without importing it. A hand-built tree would replace exactly
 * that chain.
 */

beforeEach(() => {
  server.use(...createProfileHandlers(createProfileMockState()));
});

describe("the account menu's mount", () => {
  it("hangs from a header control", async () => {
    const user = userEvent.setup();

    renderApp({ initialPath: "/", store: authenticatedAs() });

    const trigger = await screen.findByRole("button", { name: "Account" });

    /*
     * In a header, not merely on the page: `headerEnd` is the slot this whole
     * step exists to fill, and a menu that rendered anywhere else would still
     * satisfy every accessible-name query in the suite. `closest`, not
     * `document.querySelector("header")?.contains(…)` — the claim is that the
     * trigger sits inside a header, not inside the *first* one, and the two
     * only agree today because `SidebarHeader` happens to be a `div`.
     *
     * The popover's `side="bottom"` is not asserted anywhere and cannot be:
     * jsdom lays nothing out, which is why the plan files that geometry under
     * operator acceptance rather than pretending a test covers it.
     */
    expect(trigger.closest("header")).not.toBeNull();

    await user.click(trigger);

    // The contents are still reachable from where the menu now hangs, which
    // is all this case claims about them; what they *are* is the next one's.
    expect(
      await screen.findByRole("menuitem", { name: "Account" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /sign out/i })).toBeVisible();

    await user.keyboard("{Escape}");
  });

  it("holds identity, one way in and the way out, and nothing else", async () => {
    const user = userEvent.setup();

    renderApp({ initialPath: "/", store: authenticatedAs() });

    const trigger = await screen.findByRole("button", { name: "Account" });

    await user.click(trigger);

    /*
     * ADR-0053 §2's slim menu, asserted as an inventory rather than as a list
     * of things that are present: `getAllByRole` is what makes a fourth entry
     * a failure, and a fourth entry is exactly how this decision would be
     * lost — the next preference is one `DropdownMenuItem` away from landing
     * here instead of in the section that lists them.
     */
    const items = await screen.findAllByRole("menuitem");

    expect(items.map((item) => item.textContent)).toEqual([
      "Account",
      "Sign out",
    ]);
    // The theme and locale blocks were radio groups, and a radio item is the
    // one thing a settings menu leaves behind when it is emptied by hand.
    expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0);

    // The principal block is the third of the three: not a `menuitem`, because
    // it is a label and there is nothing to click.
    const menu = screen.getByRole("menu");

    expect(within(menu).getByText("Ops Operator")).toBeInTheDocument();

    await user.keyboard("{Escape}");
  });

  it("names the area rather than a section, so the index route chooses", async () => {
    const user = userEvent.setup();

    renderApp({ initialPath: "/", store: authenticatedAs() });

    await user.click(await screen.findByRole("button", { name: "Account" }));

    /*
     * `D11.9` left this item pointing at `/profile`, which had become a
     * `beforeLoad` redirect — so it worked and stopped highlighting, and the
     * review handed the fix forward to this step. Pointing at the area rather
     * than at a section is what makes a fourth section cost nothing here, and
     * `href` is the assertion because it is the one thing a redirect cannot
     * make true on its own.
     */
    expect(
      await screen.findByRole("menuitem", { name: "Account" }),
    ).toHaveAttribute("href", "/account");

    await user.keyboard("{Escape}");
  });

  it("leaves nothing of itself in the sidebar footer", async () => {
    renderApp({ initialPath: "/", store: authenticatedAs() });

    const trigger = await screen.findByRole("button", { name: "Account" });

    /*
     * **Amended at `D11.3`.** This case asserted that the region itself was
     * gone, which was the right claim while it held nothing: the footer's one
     * child was a `SidebarMenu > SidebarMenuItem > AccountMenu` chain, and an
     * empty region kept "for symmetry" is the unexercised-surface defect
     * ADR-0049 §The-shell-adapter names. ADR-0054 §5 gave the region a job of
     * its own — the version string — so the region is back and the claim
     * narrows to what `D8.5` actually moved: the *menu* is not in it.
     *
     * Narrowed rather than deleted, because the failure it guards is still
     * live: a future edit that put the account block back into the drawer
     * would leave the header trigger passing every other assertion in this
     * file while the app grew a second one.
     */
    const footer = document.querySelector('[data-slot="sidebar-footer"]');

    expect(footer).toBeInTheDocument();
    expect(footer?.contains(trigger)).toBe(false);
    expect(footer?.querySelector('[data-slot="sidebar-menu"]')).toBeNull();
  });
});
