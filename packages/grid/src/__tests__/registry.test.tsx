import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ColumnConfigMap } from "@repo/resource";
import { renderWithI18n, translator } from "./support/render";

import { buildColumns } from "../columns";
import { EMPTY_CELL, date, dateTime, text } from "../formatters";
import { gridRegistry } from "../registry";

/**
 * Registry resolution and config typing (ADR-0036 §What must be covered, 2).
 *
 * The claim under test is the one the whole indirection buys: a config carries
 * a *key*, and the key resolves to the implementation — provably, without
 * rendering a table.
 */

describe("the grid registry", () => {
  it("is the app's whole grid vocabulary, and it is small", () => {
    // If this ever grows quietly, the "a reviewer can read the vocabulary in
    // two files" claim has stopped being true.
    expect(Object.keys(gridRegistry.formatters)).toEqual(["date", "dateTime"]);
    expect(Object.keys(gridRegistry.cellRenderers)).toEqual([
      "rowActions",
      "statusBadge",
      "rolesList",
    ]);
  });
});

describe("formatters", () => {
  it("renders an ISO instant, and a missing value as a dash", () => {
    expect(date("2026-01-15T10:00:00.000Z")).toContain("2026");
    expect(dateTime("2026-01-15T10:00:00.000Z")).toContain("2026");
    // Not a blank cell: a blank reads as a rendering failure, where "never
    // signed in" is information.
    expect(date(null)).toBe(EMPTY_CELL);
    expect(dateTime(undefined)).toBe(EMPTY_CELL);
    expect(text("")).toBe(EMPTY_CELL);
  });

  it("renders an unparseable value as a dash rather than `Invalid Date`", () => {
    expect(date("not a date")).toBe(EMPTY_CELL);
  });
});

/**
 * The translator `buildColumns` resolves a config's header keys through
 * (`D7.4`).
 *
 * A real instance rather than an identity stub, so these assertions read the
 * **catalogue's** words: a header key that no catalogue answers would render as
 * the key here, which is the failure the type system cannot see.
 */
const t = translator();

/** The slice of TanStack's cell context a resolved `cell` actually reads. */
const cellContext = (value: unknown) => ({
  getValue: () => value,
  row: { id: "1", original: {} },
  table: { options: { meta: {} } },
});

describe("buildColumns", () => {
  const columns: ColumnConfigMap = {
    email: { header: "grid:filter.title", sortable: true },
    status: { header: "grid:filter.any", cellRenderer: "statusBadge" },
    createdAt: {
      header: "grid:filter.from",
      formatter: "date",
      align: "end",
    },
  };

  const built = buildColumns(columns, undefined, t);

  it("builds one def per column, in declaration order", () => {
    expect(built.map((column) => column.id)).toEqual([
      "email",
      "status",
      "createdAt",
    ]);
  });

  it("resolves each header key to the catalogue's words", () => {
    /*
     * The `D7.4` property: a config carries a key and the machinery renders a
     * sentence, without the grid learning which namespace it came from.
     *
     * The words are this package's own `grid:` copy since `D9.4` — the fixture
     * above used `demo:` keys, which belong to the admin's test harness and are
     * not declared in this program. They are arbitrary: what the case asserts
     * is that a *key* became a *sentence*, and `Filter by {{column}}` proves it
     * as well as `Name` did.
     */
    expect(built.map((column) => column.header)).toEqual([
      "Filter by {{column}}",
      "Any",
      "{{column}} from",
    ]);
  });

  it("only enables sorting where the config allows it", () => {
    // A column is sortable in config only if the endpoint's allow-list has the
    // field; offering the click and answering it with a `VALIDATION_ERROR`
    // would be worse than not offering it.
    expect(built.map((column) => column.enableSorting)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("carries the filter config and alignment as column meta", () => {
    expect(built[2]?.meta).toEqual({
      align: "end",
      filter: undefined,
      structural: false,
    });
  });

  it("marks the grid's own chrome structural, by registry key not by name", () => {
    /*
     * `structural` joined the meta at `D4.5` (ADR-0041) and is what exempts a
     * column from every preference: not offered in the Columns menu, not
     * hideable, not resizable, never in the stored value. The discriminator is
     * the `rowActions` renderer key — `shared/grid` vocabulary — so a resource
     * that named the column `operations` still gets the right answer, and one
     * that named an ordinary column `actions` does not get the wrong one.
     */
    const withChrome = buildColumns(
      {
        actions: { header: "grid:filter.title" },
        operations: {
          header: "grid:filter.to",
          cellRenderer: "rowActions",
        },
      },
      undefined,
      t,
    );

    expect(withChrome.map((column) => column.meta?.structural)).toEqual([
      false,
      true,
    ]);
    expect(withChrome.map((column) => column.enableHiding)).toEqual([
      true,
      false,
    ]);
  });

  it("resolves a cellRenderer key to its component", () => {
    const cell = built[1]?.cell;

    expect(typeof cell).toBe("function");

    const rendered = (cell as (context: unknown) => React.ReactNode)(
      cellContext("active"),
    );

    /*
     * Through the providers, because `statusBadge` reads `common:options.*`
     * since `D7.4` — a bare `render` would leave `useKeyT` with no instance and
     * assert the key rather than the word.
     */
    renderWithI18n(<>{rendered}</>);

    /*
     * The harness's `common:options.active`, not the English word (`D9.4`).
     * `optionLabel` falls back to `humanize(value)` when the catalogue has no
     * entry, so asserting "Active" here would pass with no `common` namespace
     * mounted at all — which is what this case would have become when the
     * grid's suite stopped borrowing the admin's dictionary.
     */
    expect(screen.getByText("Aktīvs")).toBeInTheDocument();
  });

  it("falls back to the text formatter when a column declares neither", () => {
    const cell = built[0]?.cell as (context: unknown) => React.ReactNode;

    expect(cell(cellContext("ada@machxi.local"))).toBe("ada@machxi.local");
  });

  it("lets a cellRenderer win over a formatter", () => {
    /*
     * Not an error — the override merge can produce a column carrying both —
     * but a renderer was chosen because it decides its own presentation, so
     * handing it a pre-formatted string would take away the thing it was
     * chosen for.
     */
    const [column] = buildColumns(
      {
        status: {
          header: "grid:filter.any",
          formatter: "date",
          cellRenderer: "statusBadge",
        },
      },
      undefined,
      t,
    );

    const rendered = (column?.cell as (context: unknown) => React.ReactNode)(
      cellContext("disabled"),
    );

    renderWithI18n(<>{rendered}</>);

    expect(screen.getByText("Atspējots")).toBeInTheDocument();
  });
});

describe("a typo'd registry key", () => {
  it("is a compile error, not a blank cell", () => {
    const columns = {
      createdAt: {
        header: "grid:filter.from",
        // @ts-expect-error `dateTiem` is not a registry key — this is the
        // property the named registry exists to buy, and `pnpm check-types`
        // is what asserts it.
        formatter: "dateTiem",
      },
      status: {
        header: "grid:filter.any",
        // @ts-expect-error nor is `statusBdage`.
        cellRenderer: "statusBdage",
      },
    } satisfies ColumnConfigMap;

    expect(Object.keys(columns)).toHaveLength(2);
  });
});
