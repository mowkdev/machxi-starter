import type { ListQuerySearch, Page } from "@repo/contracts";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ColumnConfigMap } from "@repo/resource";

import { AppGrid } from "../app-grid";
import { renderWithI18n } from "./support/render";

/**
 * The grid's chrome, as class strings (ADR-0052 §Visible state `D10.2`;
 * ADR-0054 §4 `D11.2`).
 *
 * **jsdom lays nothing out, so the assertion is the class** — the same bargain
 * `@repo/ui`'s shell suite strikes, and for the same reason: nothing here can
 * prove a row *looks* striped, and what it can prove is that the one selector
 * that produces the stripe is emitted for exactly the rows that should carry it
 * and for no others. Whether the alternation is legible in either theme is the
 * browser tier's (`D10.4`) and the operator's.
 *
 * The opt-in is the whole decision, so the off case is asserted first and
 * asserted on the default rather than on an explicit `false`: every shipped
 * screen renders unstriped today, and a default that flipped would change all
 * of them without a single call site being edited.
 */

interface Row {
  readonly id: string;
  readonly email: string;
}

const ROWS: readonly Row[] = [
  { id: "1", email: "ada@machxi.local" },
  { id: "2", email: "mo@machxi.local" },
  { id: "3", email: "sam@machxi.local" },
];

const COLUMNS: ColumnConfigMap = {
  email: { header: "grid:filter.title" },
};

const LIST_STATE: ListQuerySearch = {
  offset: 0,
  limit: 20,
  sort: [],
  filters: [],
};

const page: Page<Row> = {
  items: ROWS,
  total: ROWS.length,
  offset: 0,
  limit: 20,
  sort: [],
  filters: {},
};

const renderGrid = (striped?: boolean) =>
  renderWithI18n(
    <AppGrid
      columns={COLUMNS}
      listState={LIST_STATE}
      page={page}
      renderError={() => <p>Failed</p>}
      onListStateChange={() => {
        /* the URL round trip is `list-state`'s own suite */
      }}
      {...(striped === undefined ? {} : { striped })}
    />,
  );

/** The body rows, which are the only ones a stripe may touch. */
const bodyRows = (): HTMLElement[] =>
  screen.getAllByRole("row").filter((row) => row.closest("tbody") !== null);

describe("the resize handle", () => {
  it("carries an at-rest grip as well as its hover band", () => {
    renderGrid();

    const handle = document.querySelector('[data-slot="grid-resize-handle"]');

    /*
     * The class is the assertion, because the affordance is a pixel fact
     * (`D10.2`, ADR-0052 §Visible state). What ADR-0052 changed is that the
     * handle is visible *before* the pointer arrives: the band stays
     * transparent until hover, and the `after:` grip is what is always there.
     * Its colour is `bg-grid-tick`, a token, which is how "in both themes" is
     * satisfied by construction rather than by a second value to maintain.
     *
     * Whether the grip is actually visible to a person is `D10.4`'s spec; this
     * only refuses a silent revert to the hover-only handle.
     */
    expect(handle).toHaveClass(
      "after:absolute",
      // `--grid-tick` since `D11.2` (ADR-0054 §4): the tick is its own token
      // now, because a grip and a rule want different weights in dark.
      "after:bg-grid-tick",
      "after:h-4",
      "after:w-px",
      "hover:bg-border",
    );
    expect(handle).toHaveClass("bg-transparent");
  });
});

describe("striped rows", () => {
  it("stripes nothing by default", () => {
    renderGrid();

    expect(bodyRows()).toHaveLength(ROWS.length);

    for (const row of bodyRows()) {
      expect(row).not.toHaveClass("even:bg-grid-stripe");
    }
  });

  it("stripes every body row when the page opts in", () => {
    renderGrid(true);

    // Mirrors the default case: a `for` over an empty list asserts nothing,
    // and a fixture that stopped rendering rows would take both cases green.
    expect(bodyRows()).toHaveLength(ROWS.length);

    /*
     * On every row, not on alternate ones: `even:` is a CSS selector, so the
     * alternation happens in the browser off the row's position in the DOM.
     * A class applied to every other row *here* would be the component
     * computing an index it does not need and cannot keep honest against the
     * loading, empty and error rows — which are `<TableRow>`s too.
     */
    for (const row of bodyRows()) {
      expect(row).toHaveClass("even:bg-grid-stripe");
    }
  });

  it("keeps the hover and selected states winning over the stripe", () => {
    renderGrid(true);

    /*
     * The stripe is additive to `TableRow`'s own classes rather than a
     * replacement for them. Tailwind sorts `hover` and `data-*` after `even`,
     * so both still paint over it — but only if they are still *on the
     * element*, which is what a `className` override would have quietly ended.
     */
    for (const row of bodyRows()) {
      /*
       * The stripe is asserted **in the same call**, which is the only part of
       * "hover and selection still win" this tier can hold: jsdom mounts no
       * stylesheet, so nothing here can see a cascade, and the two `TableRow`
       * classes are unconditional — asserting them alone would pass with
       * `striped` deleted outright. What this does refuse is the stripe being
       * a *replacement* for them. The cascade itself is `D10.4`'s.
       */
      expect(row).toHaveClass(
        "even:bg-grid-stripe",
        "hover:bg-muted/50",
        "data-[state=selected]:bg-primary-tint",
      );
    }
  });
});

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
  const headerCells = (): HTMLElement[] =>
    screen
      .getAllByRole("columnheader")
      .filter((cell) => cell.closest("thead") !== null);

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

  it("gives the header its own ground, 34px and caps", () => {
    renderGrid();

    const header = document.querySelector('[data-slot="table-header"]');

    // The opaque ground rows pass under is the header band's token now, not
    // the card's — the pane no longer paints one for it to agree with.
    expect(header).toHaveClass("[&_th]:bg-grid-header", "sticky");

    // A `for` over an empty list asserts nothing, and this fixture has exactly
    // one column: a selector that stopped matching would otherwise be green.
    expect(headerCells()).toHaveLength(1);

    for (const cell of headerCells()) {
      expect(cell).toHaveClass(
        "h-[34px]",
        "px-2.5",
        "text-[11px]",
        "font-semibold",
        "tracking-[0.07em]",
        "uppercase",
      );
    }
  });

  it("gives the rows the Comfortable band and the data cells the mono face", () => {
    renderWithI18n(
      <AppGrid
        columns={{ email: { header: "grid:filter.title", mono: true } }}
        listState={LIST_STATE}
        page={page}
        renderError={() => <p>Failed</p>}
        onListStateChange={() => {
          /* not this suite's question */
        }}
      />,
    );

    const cells = screen
      .getAllByRole("cell")
      .filter((cell) => cell.closest("tbody") !== null);

    expect(cells).toHaveLength(ROWS.length);

    for (const cell of cells) {
      // 44px is Comfortable, and the only density this step ships — `D11.6`
      // adds Compact as a mode, which is why the number is asserted rather
      // than assumed away.
      expect(cell).toHaveClass("h-[44px]", "px-2.5", "text-[13px]");
      expect(cell).toHaveClass("font-mono");
    }
  });

  it("leaves a prose column in the sans face", () => {
    // The complement, so `mono` is proved to be the config's decision rather
    // than something every cell gets: `COLUMNS` declares no `mono`.
    renderGrid();

    const cells = screen
      .getAllByRole("cell")
      .filter((cell) => cell.closest("tbody") !== null);

    expect(cells).toHaveLength(ROWS.length);

    for (const cell of cells) expect(cell).not.toHaveClass("font-mono");
  });
});
