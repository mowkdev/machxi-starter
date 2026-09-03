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

/** The density block's fixture: one prose column and one badge column. */
interface RoleRow extends Row {
  readonly roles: readonly string[];
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
  count: true,
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
      keyPrefix="machxi.admin"
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
  const COLUMNS_WITH_ROLES: ColumnConfigMap = {
    email: { header: "grid:filter.title", mono: true },
    roles: { header: "grid:columns.label", cellRenderer: "rolesList" },
  };

  const rolePage: Page<RoleRow> = {
    ...page,
    items: ROWS.map((row) => ({ ...row, roles: ["admin"] })),
  };

  const renderAt = (density?: "comfortable" | "compact") =>
    renderWithI18n(
      <AppGrid
        keyPrefix="machxi.admin"
        columns={COLUMNS_WITH_ROLES}
        listState={LIST_STATE}
        page={rolePage}
        renderError={() => <p>Failed</p>}
        onListStateChange={() => {
          /* not this suite's question */
        }}
        {...(density === undefined ? {} : { density })}
      />,
    );

  const bodyCells = (): HTMLElement[] =>
    screen
      .getAllByRole("cell")
      .filter((cell) => cell.closest("tbody") !== null);

  const headerCells = (): HTMLElement[] =>
    screen
      .getAllByRole("columnheader")
      .filter((cell) => cell.closest("thead") !== null);

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

  it("leaves the mono face to the config rather than to the mode", () => {
    renderAt("compact");

    const [emailCell, rolesCell] = bodyCells();

    expect(emailCell).toHaveClass("font-mono");
    expect(rolesCell).not.toHaveClass("font-mono");
  });
});
