import type { ColumnDef } from "@tanstack/react-table";

import { mergeColumns } from "@/shared/resource/config";
import type { ColumnConfigMap, ColumnOverrides } from "@/shared/resource/types";
import { Checkbox } from "@/shared/ui";

import { text } from "./formatters";
import { gridRegistry } from "./registry";
import type { GridFeatures } from "./features";

/**
 * Config + registry → the `ColumnDef`s the engine runs on (ADR-0035).
 *
 * The whole config-driven claim lives in this function: everything the resource
 * declared as data is resolved here, once, and nothing downstream sees a
 * config again. Keeping it a plain function rather than a hook is what lets
 * ADR-0036 assert the resolution — "this key produced that renderer" — without
 * rendering a table.
 */

/** The row type the machinery works in. Features get their own back at the door. */
export type GridRow = Record<string, unknown>;

/**
 * The id of the checkbox column (ADR-0038).
 *
 * Exported because two places outside this file need to name it and neither
 * should spell it: `AppGrid` prepends it, and ADR-0041's columns menu will have
 * to exempt it from hiding and reordering by construction.
 */
export const SELECTION_COLUMN_ID = "__select__";

/**
 * The checkbox column, **built in — `AppGrid` owns it, it is not a config
 * entry** (ADR-0038).
 *
 * It exists *because of* `grid.selectable`, and nothing else in a
 * `ColumnConfigMap` is positional: making each resource declare
 * `select: { cellRenderer: "checkbox" }` first would be repetition that lets
 * the capability and the column disagree — `selectable: true` with no checkbox
 * column, or the reverse.
 *
 * The header toggles **the current page**, which is the only scope manual
 * pagination lets it honour: the client holds one server page, so a header
 * checkbox claiming "everything matching this filter" would be claiming a scope
 * it cannot deliver. The toolbar's "N selected" is what tells the truth about
 * rows the operator can no longer see.
 *
 * A plain two-state box rather than a tri-state one. Radix would give
 * `checked="indeterminate"` for free and the shadcn `Checkbox` primitive draws
 * the same tick for it, so the mixed state would be visually indistinguishable
 * from "all selected" — a worse lie than no third state at all — and editing
 * the generated primitive to add a dash is ADR-0031 work this step has no need
 * of. The count beside it is the disclosure.
 *
 * `@repo/ui`'s `TableHead` / `TableCell` already carry the
 * `[&:has([role=checkbox])]:pr-0` hooks shadcn ships for exactly this column,
 * so it needs no width or padding of its own.
 */
export const buildSelectionColumn = (): ColumnDef<GridFeatures, GridRow> => ({
  id: SELECTION_COLUMN_ID,
  header: ({ table }) => (
    <Checkbox
      aria-label="Select all rows on this page"
      checked={table.getIsAllPageRowsSelected()}
      onCheckedChange={(checked) => {
        table.toggleAllPageRowsSelected(checked === true);
      }}
    />
  ),
  cell: ({ row }) => (
    /*
     * Named by the row's own id, for the reason `RowActions` is: a page of
     * twenty otherwise has twenty controls called "Select row", which is what
     * the role-and-label discipline exists to prevent and what would force a
     * test to reach for a positional index. The id comes from `getRowId`, so it
     * is the resource's own identifier.
     */
    <Checkbox
      aria-label={`Select ${row.id}`}
      checked={row.getIsSelected()}
      onCheckedChange={(checked) => {
        row.toggleSelected(checked === true);
      }}
    />
  ),
  enableSorting: false,
  meta: { align: "start", filter: undefined },
});

export const buildColumns = (
  columns: ColumnConfigMap,
  overrides: ColumnOverrides | undefined,
): ColumnDef<GridFeatures, GridRow>[] =>
  mergeColumns(columns, overrides).map(([name, column]) => {
    const Renderer =
      column.cellRenderer === undefined
        ? null
        : gridRegistry.cellRenderers[column.cellRenderer];

    const format =
      column.formatter === undefined
        ? text
        : gridRegistry.formatters[column.formatter];

    return {
      id: name,
      accessorKey: name,
      header: column.header,
      /*
       * `cellRenderer` wins over `formatter`: a renderer receives the raw value
       * and decides its own presentation, so handing it a pre-formatted string
       * would take away the thing it was chosen for. A config declaring both is
       * not an error — the override merge can produce one — it just means the
       * formatter is unused.
       */
      cell: (context) =>
        Renderer === null ? (
          format(context.getValue())
        ) : (
          <Renderer
            value={context.getValue()}
            row={context.row.original}
            rowId={context.row.id}
            /*
             * Read from `table.options.meta` rather than closed over: that is
             * the mechanism ADR-0035 names, and it is the one that keeps these
             * defs independent of a feature's handlers. Baking `meta` in would
             * make the column defs a function of it, so a caller passing an
             * inline `meta={{ rowActions: [...] }}` would rebuild every
             * `ColumnDef` on every render — the exact cost `options.meta`
             * exists to avoid.
             */
            meta={context.table.options.meta ?? {}}
          />
        ),
      enableSorting: column.sortable === true,
      meta: { align: column.align ?? "start", filter: column.filter },
    } satisfies ColumnDef<GridFeatures, GridRow>;
  });
