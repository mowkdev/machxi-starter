import { screen } from "@testing-library/react";
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
 * Four shipped assertions already reach this control — `pages/profile`'s three
 * and `features/auth`'s logout — and all four go on reaching it by accessible
 * name, which is the point: the menu's *contents* did not move, only where it
 * hangs. What only this file claims is the move itself, in the two directions
 * that can each be wrong on their own: the trigger is in the header, and the
 * region it used to hang in holds no trace of it (`D11.3` narrowed that from
 * "the region is gone", which stopped being true when the version footer
 * gave the region a job).
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

    // The contents came across intact — the D6.3/D7.5 grouping survives.
    expect(
      await screen.findByRole("menuitem", { name: "Profile" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /sign out/i })).toBeVisible();

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
