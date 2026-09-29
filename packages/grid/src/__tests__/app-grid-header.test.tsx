import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Harness, pageOf } from "./support/demo-harness";
import { demoRows } from "./support/demo-resource";
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
 * The column's name and its controls (ADR-0080 §1, `D31.1`).
 *
 * The name is a label and sorts nothing; sort and filter are one pair of ghost
 * icon buttons at the cell's end, in that order. jsdom lays nothing out, so
 * "at the end" is asserted as structure — the controls are the cell's last
 * flex child, after a label that takes the rest — and as the absence of the
 * end-alignment the cell used to follow for an end-aligned column.
 */
describe("the header's controls", () => {
  const cellFor = (name: RegExp) =>
    screen
      .getAllByRole("columnheader")
      .find((cell) => name.test(cell.textContent ?? ""))!;

  it("the column's name is a label and sorts nothing", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<Harness page={pageOf(demoRows)} onChange={onChange} />);

    // No control is named for the bare header any more.
    expect(
      screen.queryByRole("button", { name: "Name" }),
    ).not.toBeInTheDocument();

    const label = cellFor(/^Name$/).querySelector(
      '[data-slot="grid-header-label"]',
    );

    expect(label).toHaveTextContent(/^Name$/);
    expect(label?.closest("button")).toBeNull();

    await user.click(label as HTMLElement);

    expect(onChange).not.toHaveBeenCalled();
    // And the cell's text is the name alone: the controls carry names, not text.
    expect(cellFor(/^Name$/).textContent).toBe("Name");
  });

  it("the sort control is named for its column and shows the direction it holds", async () => {
    const user = userEvent.setup();

    render(<Harness page={pageOf(demoRows)} />);

    const sort = screen.getByRole("button", { name: "Sort by Name" });

    // At rest: the neutral two-way arrow, and nothing active.
    expect(sort).not.toHaveAttribute("data-active");
    expect(sort).not.toHaveAttribute("data-direction");
    expect(sort.querySelector("svg")).toHaveClass("lucide-arrow-up-down");

    await user.click(sort);

    await waitFor(() => {
      expect(sort).toHaveAttribute("data-direction", "asc");
    });
    expect(sort).toHaveAttribute("data-active", "true");
    // The filter's active treatment, so the two read as one pair.
    expect(sort).toHaveClass("bg-accent", "text-accent-foreground");
    expect(sort.querySelector("svg")).toHaveClass("lucide-arrow-up");
    expect(cellFor(/^Name$/)).toHaveAttribute("aria-sort", "ascending");

    await user.click(sort);

    await waitFor(() => {
      expect(sort).toHaveAttribute("data-direction", "desc");
    });
    expect(sort.querySelector("svg")).toHaveClass("lucide-arrow-down");
    // The name does not change with the state; `aria-sort` carries it.
    expect(sort).toHaveAccessibleName("Sort by Name");
    expect(cellFor(/^Name$/)).toHaveAttribute("aria-sort", "descending");
  });

  it("the header's controls sit at the cell's end in the order sort, filter", () => {
    render(<Harness page={pageOf(demoRows)} />);

    const cell = cellFor(/^Name$/);
    const row = cell.firstElementChild as HTMLElement;
    const controls = row.lastElementChild as HTMLElement;

    expect(controls).toHaveAttribute("data-slot", "grid-header-controls");
    // The label takes the rest of the row and truncates; the pair never shrinks.
    expect(row.firstElementChild).toHaveClass("min-w-0", "flex-1", "truncate");
    expect(controls).toHaveClass("shrink-0");

    expect(
      [...controls.querySelectorAll("button")].map((button) =>
        button.getAttribute("aria-label"),
      ),
    ).toEqual(["Sort by Name", "Filter by Name"]);

    // The same ghost icon button at the same size, so neither moves the band.
    for (const button of controls.querySelectorAll("button")) {
      expect(button).toHaveClass("size-7");
    }

    // Start-aligned on every column, end-aligned ones included.
    const actions = cellFor(/^Actions$/);
    expect(actions).not.toHaveClass("text-right");
    expect(actions.firstElementChild).not.toHaveClass("justify-end");
    // A column with neither control renders no empty controls box.
    expect(
      actions.querySelector('[data-slot="grid-header-controls"]'),
    ).toBeNull();
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
