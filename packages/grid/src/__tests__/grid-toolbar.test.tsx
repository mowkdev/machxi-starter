import { screen } from "@testing-library/react";
import {
  PageActionsProvider,
  PageActionsTarget,
} from "@repo/ui/compositions/page-actions";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { GridToolbar } from "../grid-toolbar";
import { renderWithI18n } from "./support/render";

/**
 * Where the toolbar draws its controls (ADR-0054 §5, `D11.12`).
 *
 * §5 seats the Columns control and the primary action in the page-header
 * band, which is the delta this step takes on ADR-0038's "right side,
 * capability-driven" toolbar and ADR-0041's "in the toolbar region 0038
 * reserves". The two arrangements are one branch — is a band listening? — so
 * both halves are asserted here, because only one of them ships and the other
 * is what every other suite in this package renders.
 */

const props = {
  capabilities: { canCreate: true },
  searchable: true,
  searchValue: "",
  onSearchCommit: () => undefined,
  hotFilters: [],
  filters: [],
  onHotFilterChange: () => undefined,
  createAction: <button type="button">Add staff member</button>,
  onBulkDelete: undefined,
  toolbarStart: null,
  toolbarEnd: null,
  columnsMenu: <button type="button">Columns</button>,
  selectedIds: [],
  clearSelection: () => undefined,
} as const;

const Band = ({ children }: { readonly children: ReactNode }) => (
  <PageActionsProvider>
    <div data-testid="band" className="flex items-center gap-2">
      <button type="button">Density</button>
      <PageActionsTarget />
    </div>
    {children}
  </PageActionsProvider>
);

const toolbar = () =>
  document.querySelector('[data-slot="grid-toolbar"]') as HTMLElement;

describe("with a page-header band above it", () => {
  it("hoists Columns and the primary into the band", () => {
    renderWithI18n(
      <Band>
        <GridToolbar {...props} />
      </Band>,
    );

    const band = screen.getByTestId("band");

    expect(band).toContainElement(
      screen.getByRole("button", { name: "Columns" }),
    );
    expect(band).toContainElement(
      screen.getByRole("button", { name: "Add staff member" }),
    );
  });

  it("puts Columns before the primary, which is §5's order", () => {
    renderWithI18n(
      <Band>
        <GridToolbar {...props} />
      </Band>,
    );

    const names = [
      ...screen.getByTestId("band").querySelectorAll("button"),
    ].map((button) => button.textContent);

    expect(names).toEqual(["Density", "Columns", "Add staff member"]);
  });

  it("leaves the toolbar with no right-hand group at all", () => {
    renderWithI18n(
      <Band>
        <GridToolbar {...props} />
      </Band>,
    );

    /*
     * The left group is the toolbar's only child. Asserting the count rather
     * than the absence of the two buttons is what catches an empty right-hand
     * `div` surviving the move — 48px of band with a `gap-2` before nothing,
     * which is invisible to a query for a control that is no longer there.
     */
    expect(toolbar().children).toHaveLength(1);
    expect(toolbar()).not.toContainElement(
      screen.getByRole("button", { name: "Columns" }),
    );
  });

  it("still hoists them when the toolbar itself has nothing to draw", () => {
    renderWithI18n(
      <Band>
        <GridToolbar {...props} searchable={false} />
      </Band>,
    );

    /*
     * The empty-region rule returns `null` for the band and the portal still
     * has to fire: a grid with no search, no stances and no selection is
     * still a grid with a Columns control.
     */
    expect(toolbar()).toBeNull();
    expect(screen.getByTestId("band")).toContainElement(
      screen.getByRole("button", { name: "Columns" }),
    );
  });
});

describe("with no band above it", () => {
  it("keeps both controls in the toolbar, which is ADR-0038's arrangement", () => {
    renderWithI18n(<GridToolbar {...props} />);

    expect(toolbar()).toContainElement(
      screen.getByRole("button", { name: "Columns" }),
    );
    expect(toolbar()).toContainElement(
      screen.getByRole("button", { name: "Add staff member" }),
    );
    expect(toolbar().children).toHaveLength(2);
  });

  it("renders no right-hand group when there is nothing to put in it", () => {
    renderWithI18n(
      <GridToolbar {...props} capabilities={undefined} columnsMenu={null} />,
    );

    expect(toolbar().children).toHaveLength(1);
  });
});

describe("the selection block", () => {
  it("holds the count, the escape and bulk delete together", () => {
    renderWithI18n(
      <Band>
        <GridToolbar
          {...props}
          capabilities={{ canCreate: true, canBulkDelete: true }}
          selectedIds={["a", "b"]}
          onBulkDelete={() => undefined}
        />
      </Band>,
    );

    /*
     * Bulk delete came out of the right-hand group at `D11.12` and belongs
     * with the count it acts on, not with the hoisted view controls: it is
     * the one action here whose existence depends on the selection.
     */
    const block = screen.getByText("2 selected").parentElement;

    expect(block).toContainElement(
      screen.getByRole("button", { name: "Clear selection" }),
    );
    expect(block).toContainElement(
      screen.getByRole("button", { name: "Delete 2" }),
    );
    expect(toolbar().children).toHaveLength(1);
  });
});
