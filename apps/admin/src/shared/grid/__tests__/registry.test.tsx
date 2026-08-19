import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ColumnConfigMap } from "@/shared/resource/types";

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

describe("buildColumns", () => {
  const columns: ColumnConfigMap = {
    email: { header: "Email", sortable: true },
    status: { header: "Status", cellRenderer: "statusBadge" },
    createdAt: { header: "Created", formatter: "date", align: "end" },
  };

  const built = buildColumns(columns, undefined, {});

  it("builds one def per column, in declaration order", () => {
    expect(built.map((column) => column.id)).toEqual([
      "email",
      "status",
      "createdAt",
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
    expect(built[2]?.meta).toEqual({ align: "end", filter: undefined });
  });

  it("resolves a cellRenderer key to its component", () => {
    const cell = built[1]?.cell;

    expect(typeof cell).toBe("function");

    const rendered = (cell as (context: unknown) => React.ReactNode)({
      getValue: () => "active",
      row: { original: {} },
    });

    render(<>{rendered}</>);

    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("falls back to the text formatter when a column declares neither", () => {
    const cell = built[0]?.cell as (context: unknown) => React.ReactNode;

    expect(
      cell({ getValue: () => "ada@machxi.local", row: { original: {} } }),
    ).toBe("ada@machxi.local");
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
          header: "Status",
          formatter: "date",
          cellRenderer: "statusBadge",
        },
      },
      undefined,
      {},
    );

    const rendered = (column?.cell as (context: unknown) => React.ReactNode)({
      getValue: () => "disabled",
      row: { original: {} },
    });

    render(<>{rendered}</>);

    expect(screen.getByText("Disabled")).toBeInTheDocument();
  });
});

describe("a typo'd registry key", () => {
  it("is a compile error, not a blank cell", () => {
    const columns = {
      createdAt: {
        header: "Created",
        // @ts-expect-error `dateTiem` is not a registry key — this is the
        // property the named registry exists to buy, and `pnpm check-types`
        // is what asserts it.
        formatter: "dateTiem",
      },
      status: {
        header: "Status",
        // @ts-expect-error nor is `statusBdage`.
        cellRenderer: "statusBdage",
      },
    } satisfies ColumnConfigMap;

    expect(Object.keys(columns)).toHaveLength(2);
  });
});
