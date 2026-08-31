import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DashboardLayout } from "@/widgets/dashboard-layout";

import { renderWithProviders } from "@/test/render";

/**
 * The adapter has one job and one available failure (ADR-0049
 * §The-shell-adapter, `D12.5`).
 *
 * `@repo/ui`'s own suite proves the shell's geometry, and re-proving it here
 * would be this app testing a package. What only this side can prove is that
 * the adapter does not get between the shell and the page: a wrapper element
 * rendered here would sit inside `[data-slot="page-container"]` and silently
 * take height from every page below it without carrying the flex classes that
 * keep the budget intact. jsdom lays nothing out, so the *relation* is what is
 * asserted — `children` is a **direct** child of the container.
 */
describe("DashboardLayout", () => {
  it("hands the page straight to the shell's page container, wrapping nothing", () => {
    renderWithProviders(
      <DashboardLayout sidebar={<aside aria-label="Drawer" />} title="Home">
        <p data-testid="page">Page content</p>
      </DashboardLayout>,
    );

    const container = document.querySelector('[data-slot="page-container"]');
    const page = screen.getByTestId("page");

    /*
     * `toBe`, not `contains`: an adapter that wrapped the outlet in a `<div>`
     * would still pass a containment check, which is the whole defect.
     */
    expect(page.parentElement).toBe(container);
  });

  it("places the app's own nodes and renders no chrome of its own", () => {
    renderWithProviders(
      <DashboardLayout
        headerEnd={<button type="button">Account</button>}
        sidebar={<aside aria-label="Drawer">Navigation</aside>}
        title="Home"
      >
        <p>Page content</p>
      </DashboardLayout>,
    );

    // The drawer the app handed in, as one node rather than three regions.
    expect(
      screen.getByRole("complementary", { name: "Drawer" }),
    ).toBeInTheDocument();

    /*
     * The `headerEnd` slot, and *where* it landed. `ADR-0053 §2` puts the
     * account control in the header band rather than in the drawer's footer,
     * and a control that rendered anywhere on the page would satisfy an
     * accessible-name query just as well — so the claim is the header.
     */
    const accountControl = screen.getByRole("button", { name: "Account" });

    expect(accountControl.closest("header")).not.toBeNull();

    /*
     * Exactly one `<h1>`, and it is the shell's (ADR-0044's one-heading
     * invariant). This is the join the route file reads from the other end: a
     * page that kept its own heading would make two.
     */
    const headings = screen.getAllByRole("heading");

    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveAccessibleName("Home");
  });

  it("leaves the band's optional slots empty, because nothing in this app fills them", () => {
    /*
     * The subtraction the adapter's docblock argues for, asserted rather than
     * described. `AppShell` renders no wrapper for a slot it is handed
     * nothing, and this app hands it nothing for four of them — so a prop
     * added here before it has a consumer shows up as an element that was not
     * in the tree before. That is the slot-with-no-consumer defect ADR-0048 §2
     * spends a paragraph on, caught one layer down.
     */
    renderWithProviders(
      <DashboardLayout sidebar={<aside aria-label="Drawer" />} title="Home">
        <p>Page content</p>
      </DashboardLayout>,
    );

    expect(document.querySelector('[data-slot="banner-region"]')).toBeNull();
    expect(document.querySelector('[data-slot="page-actions"]')).toBeNull();
    /*
     * And the page container is the document variant, not the full-bleed one
     * (ADR-0054 §5): no route in this app declares `fullHeight`, because no
     * screen here is a height budget with a grid in it (ADR-0055 §3).
     */
    expect(
      document.querySelector('[data-slot="page-container"]'),
    ).not.toHaveAttribute("data-full-height");
  });

  it("carries the navigation indicator's flag through to the shell", () => {
    // The prop is a pass-through, and the failure it guards is the signature
    // accepting it and the shell never seeing it (ADR-0052 §Felt navigation).
    const { unmount } = renderWithProviders(
      <DashboardLayout
        navigating
        sidebar={<aside aria-label="Drawer" />}
        title="Home"
      >
        <p>Page content</p>
      </DashboardLayout>,
    );

    expect(screen.getByRole("progressbar")).toHaveAccessibleName("Navigating");

    unmount();

    renderWithProviders(
      <DashboardLayout sidebar={<aside aria-label="Drawer" />} title="Home">
        <p>Page content</p>
      </DashboardLayout>,
    );

    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
