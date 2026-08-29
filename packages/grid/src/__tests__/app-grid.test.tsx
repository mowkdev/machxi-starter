import type { ListQuerySearch, Page } from "@repo/contracts";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ColumnConfigMap } from "@repo/resource";

import { AppGrid } from "../app-grid";
import { renderWithI18n } from "./support/render";

/**
 * Striped rows (ADR-0052 §Visible state, `D10.2`).
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
     * Its colour is `bg-border`, a token, which is how "in both themes" is
     * satisfied by construction rather than by a second value to maintain.
     *
     * Whether the grip is actually visible to a person is `D10.4`'s spec; this
     * only refuses a silent revert to the hover-only handle.
     */
    expect(handle).toHaveClass(
      "after:absolute",
      "after:bg-border",
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
      expect(row).not.toHaveClass("even:bg-muted/30");
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
      expect(row).toHaveClass("even:bg-muted/30");
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
        "even:bg-muted/30",
        "hover:bg-muted/50",
        "data-[state=selected]:bg-muted",
      );
    }
  });
});
