import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppGrid } from "../app-grid";
import {
  LIST_STATE,
  ROWS,
  page,
  renderAt,
  renderGrid,
} from "./support/grid-fixture";
import { renderWithI18n } from "./support/render";

/**
 * The body region (`D20.7`), beside `app-grid/body.tsx`.
 *
 * The stripe, the row band and the half of the density mode that lands on a
 * `td` — the three things the body file now renders. Every assertion below is
 * the one the single `app-grid.test.tsx` held before the split; what changed
 * is which file it sits in.
 */

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

/** The body rows, which are the only ones a stripe may touch. */
const bodyRows = (): HTMLElement[] =>
  screen.getAllByRole("row").filter((row) => row.closest("tbody") !== null);

const bodyCells = (): HTMLElement[] =>
  screen.getAllByRole("cell").filter((cell) => cell.closest("tbody") !== null);

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
  it("gives the rows the Comfortable band and the data cells the mono face", () => {
    renderWithI18n(
      <AppGrid
        keyPrefix="machxi.admin"
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
      // 44px is Comfortable, which is the default and stays the default —
      // `D11.6` added Compact beside it as a mode, and the `density` describe
      // below is what holds the pair apart.
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
  /** The one badge left inside a row — the status is a dot since `D11.2`. */
  const roleBadge = (): HTMLElement => screen.getAllByText("Admin")[0]!;

  it("packs the rows at Comfortable when nothing says otherwise", () => {
    renderAt();

    expect(bodyCells()).toHaveLength(ROWS.length * 2);

    for (const cell of bodyCells()) {
      expect(cell).toHaveClass("h-[44px]", "px-2.5");
      expect(cell).not.toHaveClass("h-[34px]");
    }

    expect(roleBadge()).toHaveClass("h-[26px]", "px-2");
  });

  it("moves exactly the row height, the cell padding and the badge at Compact", () => {
    renderAt("compact");

    for (const cell of bodyCells()) {
      expect(cell).toHaveClass("h-[34px]", "px-2");
      expect(cell).not.toHaveClass("h-[44px]");
      expect(cell).not.toHaveClass("px-2.5");
      // The type does not move with the mode: 13/18 is §3's data rung, and a
      // density that shrank the letters would be a second decision.
      expect(cell).toHaveClass("text-[13px]", "leading-[18px]", "py-0");
    }

    const badge = roleBadge();

    expect(badge).toHaveClass("h-[22px]", "px-1.5", "rounded-md", "font-mono");
    expect(badge).not.toHaveClass("h-[26px]");
  });

  it("leaves the mono face to the config rather than to the mode", () => {
    renderAt("compact");

    const [emailCell, rolesCell] = bodyCells();

    expect(emailCell).toHaveClass("font-mono");
    expect(rolesCell).not.toHaveClass("font-mono");
  });
});
