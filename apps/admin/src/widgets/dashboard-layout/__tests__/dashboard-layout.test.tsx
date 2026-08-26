import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DashboardLayout } from "@/widgets/dashboard-layout";

import { renderWithProviders } from "@/test/render";

/**
 * The adapter has one job and one available failure (ADR-0049
 * §The-shell-adapter, `D8.4`).
 *
 * `@repo/ui`'s own suite proves the shell's geometry. What only this side can
 * prove is that the adapter does not get between the shell and the page: a
 * wrapper element rendered here would sit inside `[data-slot="page-container"]`
 * — the `min-h-0` box every grid divides (ADR-0037) — and silently take height
 * from all of them without carrying the flex classes that keep the budget
 * intact. jsdom lays nothing out, so the *relation* is what is asserted:
 * `children` is a **direct** child of the container, not merely inside it.
 */
describe("DashboardLayout", () => {
  it("hands the page straight to the shell's page container, wrapping nothing", () => {
    renderWithProviders(
      <DashboardLayout sidebar={<aside aria-label="Drawer" />} title="Staff">
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

  it("places what it is handed and renders no chrome of its own", () => {
    renderWithProviders(
      <DashboardLayout
        fullHeight
        sidebar={<aside aria-label="Drawer">Navigation</aside>}
        title="Staff"
      >
        <p>Page content</p>
      </DashboardLayout>,
    );

    expect(
      screen.getByRole("complementary", { name: "Drawer" }),
    ).toBeInTheDocument();

    const headings = screen.getAllByRole("heading");

    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveAccessibleName("Staff");

    /*
     * `fullHeight` reaches the composition rather than stopping at the
     * adapter's signature — the join point the three routing tests read from
     * the other end.
     */
    expect(
      document.querySelector('[data-slot="page-container"]'),
    ).toHaveAttribute("data-full-height", "");
  });
});
