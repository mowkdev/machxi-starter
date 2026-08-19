import {
  columnFilteringFeature,
  rowPaginationFeature,
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
 * What the three registered features contribute is state and API only —
 * `getCanSort` / `getToggleSortingHandler` and the multi-sort cycling for
 * headers; `rowCount` (the envelope's own `meta.pagination.total`) feeding
 * `getPageCount()`, which is where the pager's last page comes from; and the
 * column-filter state the filter controls read and write. Every one of them is
 * driven from the URL (ADR-0034) and none of them computes over rows: the page
 * that renders is the page the server sent, in the order the server sent it.
 *
 * Built once, at module scope, because the identity of this object is part of
 * the table's identity — rebuilding it per render would defeat the engine's
 * memoisation.
 */
export const gridFeatures = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  columnFilteringFeature,
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
  },
});

export type GridFeatures = typeof gridFeatures;
