import {
  columnFilteringFeature,
  columnOrderingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
} from "@tanstack/react-table";

import type { FilterControlConfig } from "@/shared/resource/types";

import type { GridMeta } from "./types";

/**
 * The engine's feature set (ADR-0035 §The grid half, amended D3.6 for v9).
 *
 * **The row models are the point of this file, by their absence.** v9 makes
 * features and row-model factories imports rather than flags, so a grid that
 * only ever renders one server-supplied page does not import
 * `createSortedRowModel`, `createFilteredRowModel` or `createPaginatedRowModel`
 * at all: the code that *could* sort, filter or paginate the fetched page
 * locally is not in the bundle to be called. The `manual*` flags on `AppGrid`
 * say the same thing; this says it structurally, which is a stronger version of
 * the honesty ADR-0035 asks for than the flags alone were.
 *
 * What the registered features contribute is state and API only —
 * `getCanSort` / `getToggleSortingHandler` and the multi-sort cycling for
 * headers; `rowCount` (the envelope's own `meta.pagination.total`) feeding
 * `getPageCount()`, which is where the pager's last page comes from; and the
 * column-filter state the filter controls read and write. Every one of them is
 * driven from the URL (ADR-0034) and none of them computes over rows: the page
 * that renders is the page the server sent, in the order the server sent it.
 *
 * **`rowSelectionFeature` joined at `D4.3`** (ADR-0038), the way the first three
 * did — registered, contributing state and API, computing nothing over rows.
 * Its state is the exception to the sentence above: selection is not driven from
 * the URL, because it is *action context* rather than view description, and a
 * link carrying staged ids reproduces nothing useful (ADR-0038 §Selection). It
 * is keyed by `getRowId`, which `AppGrid` always sets, so a row selected on page
 * one is still selected on page three.
 *
 * **`columnSizingFeature`, `columnOrderingFeature` and `columnVisibilityFeature`
 * joined at `D4.5`** (ADR-0041), and they are the same kind of arrival: state
 * and API, no row model. Reordering and hiding columns computes nothing over
 * rows, so `features.ts` keeps the structural honesty it was built for — the
 * code that could sort or filter a page locally is absent, not disabled.
 *
 * Their three state slices are controlled by the ADR-0041 preferences store
 * rather than by the URL, which is the taxonomy that ADR draws: the URL owns
 * *view* state, preferences own *ergonomics*, and the table owns nothing
 * durable. Every stateful slice this grid runs is now fully controlled from
 * somewhere else.
 *
 * **`columnResizingFeature` is deliberately absent, and that is a `D4.5`
 * amendment to ADR-0041.** v9 splits sizing in two: `columnSizingFeature` holds
 * the durable widths, `columnResizingFeature` holds the transient drag and
 * `header.getResizeHandler()`. The handler captures its start width from
 * `column.getSize()`, which for a column nobody has sized yet is the engine's
 * 150px default — while this grid's *actual* default is "whatever the content
 * needed". So the first drag on any column would snap it to 150px before
 * tracking the pointer. The drag is fifteen lines and takes its start width
 * from the header cell itself, which keeps auto-layout for untouched columns
 * and costs one unregistered feature. See `app-grid.tsx`.
 *
 * Registering it unconditionally rather than per-capability is deliberate: the
 * feature set is the table's identity, so a set that changed with a config flag
 * would rebuild every table whose resource declared one. The *capability* is
 * what decides whether a checkbox column exists to write the state; the feature
 * with no column to drive it contributes an empty `rowSelection` and nothing
 * else.
 *
 * Built once, at module scope, because the identity of this object is part of
 * the table's identity — rebuilding it per render would defeat the engine's
 * memoisation.
 */
export const gridFeatures = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  columnFilteringFeature,
  rowSelectionFeature,
  columnSizingFeature,
  columnOrderingFeature,
  columnVisibilityFeature,
  /*
   * v9's type-only meta slots, which replace v8's global `declare module`
   * augmentation. Per-table rather than program-global is the better fit here:
   * this is `AppGrid`'s meta contract, not every table in the app's.
   */
  tableMeta: {} as GridMeta<unknown>,
  columnMeta: {} as {
    readonly align: "start" | "end";
    /*
     * `| undefined` explicitly, because the repository runs
     * `exactOptionalPropertyTypes`: most columns have no filter, and writing
     * `filter: undefined` has to be legal for the builder to stay one
     * expression instead of a conditional spread per column.
     */
    readonly filter?: FilterControlConfig | undefined;
    /*
     * Whether this column is the grid's own chrome rather than one of the
     * resource's fields (ADR-0041, `D4.5`) — the selection checkbox and the
     * row-actions column.
     *
     * It lives in `columnMeta` rather than as `enableResizing` on the column
     * def because `enableResizing` is `columnResizingFeature`'s, and that
     * feature is deliberately not registered (see above). This grid needs the
     * *fact* in one place regardless: the menu reads it, the resize handle
     * reads it, and `enableHiding` — which does exist, being
     * `columnVisibilityFeature`'s — is derived from it.
     */
    readonly structural?: boolean | undefined;
  },
});

export type GridFeatures = typeof gridFeatures;
