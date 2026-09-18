import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderAt, renderGrid } from "./support/grid-fixture";

/**
 * The header region (`D20.7`), beside `app-grid/header.tsx`.
 *
 * The resize handle, the header band's own geometry and the half of the
 * density mode that lands on a `th` — the three things the header file now
 * renders. Every assertion below is the one the single `app-grid.test.tsx`
 * held before the split; what changed is which file it sits in.
 */

const headerCells = (): HTMLElement[] =>
  screen
    .getAllByRole("columnheader")
    .filter((cell) => cell.closest("thead") !== null);

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
});

/**
 * The density mode (`D11.6`, ADR-0053 §2, ADR-0054 §6).
 *
 * **Three values move and nothing else does**, which is the whole of §6 and
 * the only thing worth asserting here: the body row's height, the horizontal
 * cell padding on *both* the `th` and the `td`, and the in-row badge. The
 * complement is asserted in the same cases — the header keeps its 34px height,
 * the cell type stays 13/18, the mono face is still the config's — because a
 * mode that quietly moved a fourth value would pass a test that only looked at
 * the three.
 *
 * Classes rather than pixels, for the reason the block above gives: jsdom lays
 * nothing out. The measured version is `apps/admin/e2e/grid-layout.spec.ts`.
 */
describe("density", () => {
  it("keeps the header at 34 in both modes and moves its padding with the body's", () => {
    // The padding is a *column* value and the height is a *row* one: a `td` at
    // 8 under a `th` at 10 puts every label two pixels off its own column, and
    // a Compact body row is 34, which is what the header already is.
    renderAt("compact");

    expect(headerCells()).toHaveLength(2);

    for (const cell of headerCells()) {
      expect(cell).toHaveClass("h-[34px]", "px-2");
      expect(cell).not.toHaveClass("px-2.5");
    }
  });
});
