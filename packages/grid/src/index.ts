/**
 * The v2 data grid, extracted (`D9.4`, ADR-0051).
 *
 * The largest slice this deliverable moves, and it moved whole: the table over
 * TanStack Table v9 in manual mode, the toolbar and its capability join, the
 * filter dialogs and chips, the pager, the column preferences and their
 * storage adapter, and the record-navigation carrier of
 * [ADR-0044](../../../docs/adr/0044-record-routes-without-list-state.md).
 * Everything ADRs [0037](../../../docs/adr/0037-grid-viewport-layout.md)–[0044]
 * decided is unchanged; what changed is the address.
 *
 * **Two things the move made explicit**, both because a package may not name
 * what an app owns:
 *
 * - **The error panel is a slot.** `AppGrid` took the admin's `QueryError`,
 *   which turns an unknown into a sentence through that app's notifications
 *   and its `errors` catalogue. It now takes `renderError`, and the app's door
 *   supplies it — so no call site in `apps/admin` changed.
 * - **The grid's copy is its own namespace** (`./i18n`), registered onto the
 *   app's instance through ADR-0046 §13's `register`. That is §13's first real
 *   use, which `D9.2` built the mechanism for.
 *
 * `@tanstack/react-router` is a **peer** (ADR-0051): `record-navigation.ts`
 * calls it, every planned SPA uses it, and an injected seam would buy
 * portability to a router no plan names.
 */

export { AppGrid, type AppGridProps } from "./app-grid";

export {
  RolesList,
  RowActions,
  StatusBadge,
  type ValueOnlyProps,
} from "./cells";

export {
  filterableColumns,
  fromColumnFiltersState,
  toColumnFilterValue,
  toColumnFiltersState,
  toListFilters,
  unescapeContains,
  type ColumnFilterValue,
} from "./column-filters";

export { chipsForState, type FilterChip } from "./filter-chips";

export { EMPTY_CELL, date, dateTime, text } from "./formatters";

export { GRID_NAMESPACE, bundles, loadCatalogue, register } from "./i18n";

export {
  clearedFilters,
  containsPattern,
  filterKey,
  fromSortingState,
  isStranded,
  lastPageOffset,
  listSearchDefaults,
  toSortingState,
  withFilters,
  withLimit,
  withOffset,
  withSearch,
  withSort,
  withoutFilter,
} from "./list-state";

export {
  clampColumnWidth,
  createGridPreferences,
  createLocalStorageAdapter,
  createMemoryStorage,
  gridStorageKey,
  parseGridStorageKey,
  reconcile,
  type GridPreferenceDefaults,
  type GridPreferences,
  type GridPreferencesStore,
  type PreferenceStorage,
} from "./preferences";

export { useCarriedListState, useRecordNavigation } from "./record-navigation";

export type {
  CellRenderer,
  CellRendererProps,
  Formatter,
  GridMeta,
  GridToolbarContext,
  RowAction,
} from "./types";

export {
  PreferenceStorageProvider,
  useGridPreferences,
} from "./use-grid-preferences";

/**
 * The aggregate outcome as one sentence (`D9.6`, ADR-0038, ADR-0043
 * §Notifications).
 *
 * Here rather than in `@repo/app-services` because every key it writes is
 * `grid:bulk.*` — this package's namespace — and `D9.5` settled that code
 * travels with the copy it names. The `BulkOutcome` it reads is
 * `@repo/api-client`'s, which is the split ADR-0038 already drew: running the
 * fan-out is an API concern, saying what happened is the grid's.
 */
export { summariseBulk, type BulkSummary } from "./bulk-summary";
