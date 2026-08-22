import type { ColumnDef, Row, Table } from "@tanstack/react-table";

import { useT, type TranslateKey } from "@/shared/i18n";
import { mergeColumns } from "@/shared/resource/config";
import type {
  ColumnConfig,
  ColumnConfigMap,
  ColumnOverrides,
} from "@/shared/resource/types";
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
 * Whether a column is **structural** — the grid's own chrome rather than one of
 * the resource's fields (ADR-0041).
 *
 * Structural columns are exempt from every preference by construction: they are
 * not offered in the Columns menu, cannot be hidden or reordered, are not
 * resizable, and never enter the stored value. The selection column is pinned
 * first and the row-actions column last, and neither position is a convention
 * anyone has to remember.
 *
 * The discriminator is the **registry key**, not a column name: `rowActions` is
 * `shared/grid` vocabulary (`CellRendererKey`), so this stays a statement about
 * the machinery rather than domain knowledge `shared` may not hold (ADR-0032).
 * A resource that called its column `operations` still gets the right answer;
 * one that put a `rowActions` renderer in the middle of its config still gets
 * it last, which is the point of doing this here.
 */
export const isStructuralColumn = (column: ColumnConfig): boolean =>
  column.cellRenderer === "rowActions";

/** A resource's own columns, in config order — everything a preference governs. */
export const movableColumns = (
  columns: readonly (readonly [string, ColumnConfig])[],
): readonly string[] =>
  columns.flatMap(([name, column]) =>
    isStructuralColumn(column) ? [] : [name],
  );

/** The structural tail, pinned after every movable column. */
export const structuralColumns = (
  columns: readonly (readonly [string, ColumnConfig])[],
): readonly string[] =>
  columns.flatMap(([name, column]) =>
    isStructuralColumn(column) ? [name] : [],
  );

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
/**
 * The two checkboxes are **components**, not inline render functions, since
 * `D7.2`.
 *
 * Their accessible names are copy now, so they need `useT()` — and a hook may
 * only be called from a component. A `header`/`cell` arrow is invoked through
 * `FlexRender`, which is close enough to a component to look safe and is not a
 * promise the engine makes; naming them makes the rule the compiler's rather
 * than the reader's.
 */
const SelectAllCell = ({
  table,
}: {
  readonly table: Table<GridFeatures, GridRow>;
}) => {
  const { t } = useT("grid");

  return (
    <Checkbox
      aria-label={t("selection.selectAll")}
      checked={table.getIsAllPageRowsSelected()}
      onCheckedChange={(checked) => {
        table.toggleAllPageRowsSelected(checked === true);
      }}
    />
  );
};

/*
 * Named by the row's own id, for the reason `RowActions` is: a page of twenty
 * otherwise has twenty controls called "Select row", which is what the
 * role-and-label discipline exists to prevent and what would force a test to
 * reach for a positional index. The id comes from `getRowId`, so it is the
 * resource's own identifier.
 */
const SelectRowCell = ({
  row,
}: {
  readonly row: Row<GridFeatures, GridRow>;
}) => {
  const { t } = useT("grid");

  return (
    <Checkbox
      aria-label={t("selection.selectRow", { id: row.id })}
      checked={row.getIsSelected()}
      onCheckedChange={(checked) => {
        row.toggleSelected(checked === true);
      }}
    />
  );
};

export const buildSelectionColumn = (): ColumnDef<GridFeatures, GridRow> => ({
  id: SELECTION_COLUMN_ID,
  header: ({ table }) => <SelectAllCell table={table} />,
  cell: ({ row }) => <SelectRowCell row={row} />,
  enableSorting: false,
  // Structural (ADR-0041): never hidden, never resized, never in the menu.
  enableHiding: false,
  meta: { align: "start", filter: undefined, structural: true },
});

/**
 * `t` is the app-wide translator, not the `grid` one (`D7.4`, ADR-0046 §7).
 *
 * A column's `header` is a key from **the resource's** namespace — `staff:` or
 * `users:` — and this function renders both without learning either name, which
 * is exactly what ADR-0032 asks of `shared/grid`. Resolving it here, once, is
 * also what keeps every downstream reader (`FlexRender`, the columns menu, the
 * filter dialog's title, the resize handle's label) working on plain strings.
 */
export const buildColumns = (
  columns: ColumnConfigMap,
  overrides: ColumnOverrides | undefined,
  t: TranslateKey,
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
      header: t(column.header),
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
      /*
       * The row-actions column is chrome, not a field (ADR-0041): hiding it
       * would strand every row's menu behind a preference, and resizing a
       * column of icon buttons answers no question. Everything else is
       * hideable and resizable — per-column flags would be config vocabulary
       * with no consumer, which the ADR refuses as YAGNI.
       */
      enableHiding: !isStructuralColumn(column),
      meta: {
        align: column.align ?? "start",
        filter: column.filter,
        structural: isStructuralColumn(column),
      },
    } satisfies ColumnDef<GridFeatures, GridRow>;
  });
