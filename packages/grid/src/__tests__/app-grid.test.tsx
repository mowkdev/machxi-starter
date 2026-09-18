import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppGrid } from "../app-grid";
import { COLUMNS, LIST_STATE, page, renderGrid } from "./support/grid-fixture";
import { renderWithI18n } from "./support/render";

/**
 * The composing shell (`D20.7`).
 *
 * What is left in `app-grid.tsx` after the split is the props contract, the
 * region stack and the chrome between the regions — so what is left here are
 * the cases about exactly that: the scroll pane, the table element the two
 * regions hang off, and the band stack the regions sit in. The header's own
 * cases are in `app-grid-header.test.tsx` and the rows' in
 * `app-grid-body.test.tsx`, beside the files that now render them.
 */

/**
 * Instrument's band chrome (ADR-0054 §4, `D11.2`).
 *
 * The same bargain the stripe strikes: jsdom lays nothing out, so what a suite
 * can hold is that the values the record names are the values the component
 * emits — 34px header, 44px rows, the caps label, the band rules, and a table
 * that no longer draws itself a border box. Whether any of it *looks* right is
 * the browser tier's and the operator's, by construction (plan §The reference
 * settled: "value equality plus a human look, never an automated pixel diff").
 */
describe("band chrome", () => {
  it("retires the card frame from the scroll pane", () => {
    renderGrid();

    const pane = document.querySelector('[data-slot="grid-scroll"]');

    /*
     * The pane keeps every one of ADR-0037's geometry classes — the budget is
     * carried, not superseded — and loses exactly the three that drew a card
     * around the table.
     */
    expect(pane).toHaveClass("scrollbar-thin", "min-h-64", "overflow-auto");
    expect(pane).not.toHaveClass("rounded-md");
    expect(pane).not.toHaveClass("border");
    expect(pane).not.toHaveClass("bg-card");
  });

  it("closes the header band with the strong rule and the rows with the quiet one", () => {
    renderGrid();

    const table = screen.getByRole("table");

    // Still separated borders — the sticky header's bill from `D4.1`, which
    // ADR-0054 carries rather than repeals.
    expect(table).toHaveClass("border-separate");
    expect(table).toHaveClass("[&_thead_th]:border-border-strong");
    expect(table).toHaveClass("[&_tbody_td]:border-grid-rule");
  });
});

/**
 * The band stack (ADR-0054 §5, `D11.4`).
 *
 * §5 draws the inset as a stack of full-width bands, and the grid owns three
 * of them: the toolbar at 48, the "Filtered by" row at 40 and the pager at 48.
 * What a jsdom suite can hold is the same thing the sibling describe holds —
 * the numbers the record names are the numbers the component emits, and the
 * twelve pixels of card-era `gap` between the regions are gone. Whether they
 * line up with the shell's own bands is `grid-layout.spec.ts`'s, in a browser.
 */
describe("the band stack", () => {
  it("declares the toolbar and pager bands at 48px with no gap between them", () => {
    renderWithI18n(
      <AppGrid
        keyPrefix="machxi.admin"
        columns={COLUMNS}
        listState={LIST_STATE}
        page={page}
        searchable
        renderError={() => <p>Failed</p>}
        onListStateChange={() => {
          /* not this suite's question */
        }}
      />,
    );

    const toolbar = document.querySelector('[data-slot="grid-toolbar"]');
    const pager = screen.getByRole("navigation", { name: "Pagination" });

    /*
     * `min-h-12`, not `h-12`, and asserted as written: both bands keep the
     * `flex-wrap` that lets a narrow viewport stack them, and a fixed height
     * would spill the second row out of the band rather than growing it.
     */
    expect(toolbar).toHaveClass("min-h-12", "shrink-0", "px-4");
    expect(pager).toHaveClass("min-h-12", "shrink-0", "px-4");
    expect(pager).not.toHaveClass("py-3");

    /*
     * The column the bands stack in. `gap-3` was the card era's spacing; bands
     * declare their own height and sit flush, the way the header and
     * page-header bands above them do.
     */
    const stack = toolbar?.parentElement;

    expect(stack).toHaveClass("flex", "flex-col", "min-h-0", "flex-1");
    expect(stack).not.toHaveClass("gap-3");
  });

  it("gives the toolbar search §3's 32px and 13px control type", () => {
    renderWithI18n(
      <AppGrid
        keyPrefix="machxi.admin"
        columns={COLUMNS}
        listState={LIST_STATE}
        page={page}
        searchable
        renderError={() => <p>Failed</p>}
        onListStateChange={() => {
          /* not this suite's question */
        }}
      />,
    );

    /*
     * The `md:` half is asserted alongside the bare one because the `Input`
     * primitive spells its own size as `text-base md:text-sm`: dropping the
     * variant would leave the control at 14px from 768px up, which is every
     * viewport this band is drawn at, and no unprefixed assertion would see it.
     */
    expect(screen.getByRole("searchbox", { name: "Search" })).toHaveClass(
      "h-8",
      "text-[13px]",
      "md:text-[13px]",
    );
  });

  it("gives the pager's controls §3's 30px", () => {
    renderWithI18n(
      <AppGrid
        keyPrefix="machxi.admin"
        columns={COLUMNS}
        listState={LIST_STATE}
        page={page}
        renderError={() => <p>Failed</p>}
        onListStateChange={() => {
          /* not this suite's question */
        }}
      />,
    );

    for (const name of [
      "First page",
      "Previous page",
      "Next page",
      "Last page",
    ])
      expect(screen.getByRole("button", { name })).toHaveClass("size-[30px]");

    /*
     * The rows-per-page trigger takes its 30 through the primitive's own
     * `data-[size=sm]:` variant, because an unprefixed `h-[30px]` is the less
     * specific selector of the two and `cn` cannot merge across modifiers — a
     * bare override would lose silently, which is exactly the kind of quiet
     * loss this assertion exists to catch.
     */
    expect(screen.getByRole("combobox", { name: "Rows per page" })).toHaveClass(
      "data-[size=sm]:h-[30px]",
    );
  });
});
