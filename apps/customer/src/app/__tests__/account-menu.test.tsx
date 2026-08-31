import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { authenticated } from "@/test/principals";
import { renderApp } from "@/test/render";

/**
 * The account control, asserted through the real route tree (`D12.5`,
 * ADR-0053 §2, ADR-0055 §3).
 *
 * Mounted through `renderApp` rather than by rendering the widget, because the
 * hand-off is part of what is under test: `app-sidebar` exports the control,
 * the `_dashboard` route file composes it, and `dashboard-layout` places it
 * into `headerEnd` without importing it. A hand-built tree would replace
 * exactly that chain.
 *
 * **The inventory is the point of the second case.** ADR-0053 §2 slimmed this
 * menu to identity, one way in and the way out, and the way that decision gets
 * lost is one `DropdownMenuItem` at a time: `D12.7`'s theme, locale and density
 * controls belong in `/account/preferences`, and each of them is a two-line
 * change away from landing here instead. `getAllByRole` is what makes a fourth
 * entry a failure rather than a thing the suite does not look at.
 */
describe("the account control", () => {
  it("hangs from the shell's header, not from the drawer", async () => {
    const user = userEvent.setup();

    renderApp({ initialPath: "/", store: authenticated() });

    const trigger = await screen.findByRole("button", { name: "Account" });

    /*
     * In a header, not merely on the page: `headerEnd` is the slot ADR-0048
     * §2 promised a second consumer for, and this is that consumer arriving.
     * `closest`, not `document.querySelector("header")?.contains(…)` — the
     * claim is that the trigger sits inside a header, not inside the *first*
     * one, and the two only agree today because `SidebarHeader` is a `div`.
     *
     * The popover's `side="bottom"` is not asserted anywhere and cannot be:
     * jsdom lays nothing out, which is why that geometry is operator
     * acceptance rather than a test pretending to cover it.
     */
    expect(trigger.closest("header")).not.toBeNull();

    // And nothing of it stayed in the drawer's footer, which holds the version
    // string alone (ADR-0054 §5).
    const footer = document.querySelector('[data-slot="sidebar-footer"]');

    expect(footer).toBeInTheDocument();
    expect(footer?.contains(trigger)).toBe(false);

    await user.click(trigger);
    await user.keyboard("{Escape}");
  });

  it("holds identity, one way in and the way out, and nothing else", async () => {
    const user = userEvent.setup();

    renderApp({ initialPath: "/", store: authenticated() });

    await user.click(await screen.findByRole("button", { name: "Account" }));

    const items = await screen.findAllByRole("menuitem");

    expect(items.map((item) => item.textContent)).toEqual([
      "Account",
      "Sign out",
    ]);
    /*
     * The theme and locale blocks are radio groups wherever they are drawn,
     * and a radio item is the one thing a settings menu leaves behind when it
     * is emptied by hand. This app never had them here; the assertion is what
     * keeps it that way.
     */
    expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0);

    // The identity block is the third of the three: not a `menuitem`, because
    // it is a label with nothing to click.
    const menu = screen.getByRole("menu");

    expect(within(menu).getByText("Cara Customer")).toBeInTheDocument();
    expect(within(menu).getByText("customer@machxi.local")).toBeInTheDocument();

    await user.keyboard("{Escape}");
  });

  it("names the area rather than a section, so the index route chooses", async () => {
    const user = userEvent.setup();

    renderApp({ initialPath: "/", store: authenticated() });

    await user.click(await screen.findByRole("button", { name: "Account" }));

    /*
     * `href` rather than a click, and deliberately: `/account` is `D12.6`'s
     * route, so this entry is a plain anchor until the typed `Link` compiles
     * (see the widget's own comment). Asserting the address is what makes that
     * swap a one-line change under a test that already stands over it — and
     * pointing at the area rather than at a section is ADR-0053 §1's shape,
     * which is what makes a fourth section cost nothing here.
     */
    expect(
      await screen.findByRole("menuitem", { name: "Account" }),
    ).toHaveAttribute("href", "/account");

    await user.keyboard("{Escape}");
  });

  it("falls back to the email when a customer has no name", async () => {
    const user = userEvent.setup();

    /*
     * A live branch in this app in a way it is not in the admin: `staff` names
     * are `NOT NULL` and a `user`'s are not (ADR-0017), so a customer created
     * without one is a real row rather than an impossible state, and the
     * control has to greet them with something.
     */
    renderApp({
      initialPath: "/",
      store: authenticated({ firstName: null, lastName: null }),
    });

    await user.click(await screen.findByRole("button", { name: "Account" }));

    const menu = screen.getByRole("menu");

    expect(
      within(menu).getAllByText("customer@machxi.local").length,
    ).toBeGreaterThan(0);

    await user.keyboard("{Escape}");
  });
});
