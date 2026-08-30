import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  PageActionsPortal,
  PageActionsProvider,
  PageActionsTarget,
  usePageActionsContainer,
} from "@repo/ui/compositions/page-actions";

/**
 * The channel a page's view controls travel to the page-header band
 * (ADR-0054 §5, `D11.12`).
 *
 * Four claims, and each of them is one a broken implementation would
 * otherwise pass silently:
 *
 * 1. A portaled control lands **inside the band's group**, not merely
 *    somewhere in the document — which is the whole difference between a
 *    hoisted control and one still drawn where it was built.
 * 2. It lands **after** whatever the app itself put there, because §5's order
 *    is density (the app's) then Columns then the primary (the grid's).
 * 3. With no band listening, the portal renders **nothing** rather than
 *    throwing or falling back into the consumer's own tree — that `null` is
 *    the branch every consumer switches on.
 * 4. The landing site is `display: contents`, so the controls are flex items
 *    of the band itself and share its gap. A nested flex box would look
 *    almost right and space the pair differently from its neighbour.
 */

const Band = ({ children }: { readonly children?: ReactNode }) => (
  <PageActionsProvider>
    <div data-testid="band" className="flex items-center gap-2">
      <button type="button">Density</button>
      <PageActionsTarget />
    </div>
    {children}
  </PageActionsProvider>
);

describe("the page-actions channel", () => {
  it("lands a portaled control inside the band's group", () => {
    render(
      <Band>
        <PageActionsPortal>
          <button type="button">Columns</button>
        </PageActionsPortal>
      </Band>,
    );

    const band = screen.getByTestId("band");

    expect(band).toContainElement(
      screen.getByRole("button", { name: "Columns" }),
    );
  });

  it("puts it after what the app itself passed", () => {
    render(
      <Band>
        <PageActionsPortal>
          <button type="button">Columns</button>
        </PageActionsPortal>
      </Band>,
    );

    /*
     * Document order inside the band, read off the accessible names: §5 draws
     * density first and the hoisted controls after it, and the target is
     * rendered last in `AppShell` for exactly that reason. Comparing the two
     * buttons' order rather than an index keeps the case honest if the band
     * ever holds a third thing.
     */
    const names = [
      ...screen.getByTestId("band").querySelectorAll("button"),
    ].map((button) => button.textContent);

    expect(names).toEqual(["Density", "Columns"]);
  });

  it("renders nothing when no band is listening", () => {
    render(
      <PageActionsPortal>
        <button type="button">Columns</button>
      </PageActionsPortal>,
    );

    expect(screen.queryByRole("button", { name: "Columns" })).toBeNull();
  });

  it("reports the container so a consumer can choose where to draw", () => {
    const Probe = () => (
      <span data-testid="probe">
        {usePageActionsContainer() === null ? "no band" : "band"}
      </span>
    );

    const { rerender } = render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("no band");

    rerender(
      <Band>
        <Probe />
      </Band>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("band");
  });

  it("gives the landing site no box of its own", () => {
    render(<Band />);

    /*
     * `display: contents` and nothing else. A `flex` or a `gap` here would
     * space the hoisted pair separately from the control beside them, which
     * is a seam no screenshot pair reliably shows.
     */
    const target = screen
      .getByTestId("band")
      .querySelector('[data-slot="page-actions-target"]');

    expect(target).not.toBeNull();
    expect(target).toHaveClass("contents");
    expect(target?.className.trim()).toBe("contents");
  });
});
