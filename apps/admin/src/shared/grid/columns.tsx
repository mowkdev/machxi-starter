import type { ColumnDef } from "@tanstack/react-table";

import { mergeColumns } from "@/shared/resource/config";
import type { ColumnConfigMap, ColumnOverrides } from "@/shared/resource/types";

import { text } from "./formatters";
import { gridRegistry } from "./registry";
import type { GridMeta } from "./types";
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

export const buildColumns = (
  columns: ColumnConfigMap,
  overrides: ColumnOverrides | undefined,
  meta: GridMeta<unknown>,
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
            meta={meta}
          />
        ),
      enableSorting: column.sortable === true,
      meta: { align: column.align ?? "start", filter: column.filter },
    } satisfies ColumnDef<GridFeatures, GridRow>;
  });
