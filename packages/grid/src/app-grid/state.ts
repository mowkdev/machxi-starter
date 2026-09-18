import type { Filter, ListQuerySearch, Page } from "@repo/contracts";
import {
  useTable,
  type ColumnFiltersState,
  type ColumnOrderState,
  type ColumnSizingState,
  type ColumnVisibilityState,
  type OnChangeFn,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useKeyT, useT, type TranslationKey } from "@repo/i18n";
import { mergeColumns } from "@repo/resource";
import type {
  ColumnConfigMap,
  ColumnOverrides,
  GridCapabilities,
  UnknownShape,
} from "@repo/resource";

import {
  filterableColumns,
  fromColumnFiltersState,
  toColumnFiltersState,
} from "../column-filters";
import type { ColumnsMenuEntry } from "../columns-menu";
import {
  SELECTION_COLUMN_ID,
  buildColumns,
  buildSelectionColumn,
  movableColumns,
  structuralColumns,
  type GridRow,
} from "../columns";
import { gridFeatures, type GridFeatures } from "../features";
import {
  fromSortingState,
  isStranded,
  lastPageOffset,
  toSortingState,
  withFilters,
  withLimit,
  withOffset,
  withSort,
} from "../list-state";
import {
  clampColumnWidth,
  type GridPreferences,
  type GridPreferencesStore,
  type PreferenceStorage,
} from "../preferences";
import type { GridMeta, GridToolbarContext } from "../types";
import { useGridPreferences } from "../use-grid-preferences";

/**
 * `AppGrid`'s state wiring, as one hook (`D20.7`).
 *
 * The component this came out of held the wiring, the header and the body at
 * once; the three are now three files and `app-grid.tsx` composes them. Nothing
 * about *what* any of it does changed — every memo, handler and effect below is
 * the one that was there, in the order it was called in, which is what makes
 * the move a move rather than a rewrite: React's rule is about the sequence of
 * hook calls, so a split that reordered them would be a behaviour change even
 * with every test still green.
 */

const NO_ROWS: readonly never[] = [];

/**
 * One frozen empty array for the not-selectable case.
 *
 * `getSelectedRowIds()` builds a fresh array per call, so a `[]` literal here
 * would give the toolbar context a new identity every render and defeat the
 * memo below for exactly the grids that have no selection to track.
 */
const EMPTY_IDS: readonly string[] = Object.freeze([]);

/** The grid's own table instance, named so the header and body can take one. */
export type AppGridTable = ReturnType<typeof useTable<GridFeatures, GridRow>>;

/** What `table.getHeaderGroups()` answers, for the header's prop. */
export type GridHeaderGroups = ReturnType<AppGridTable["getHeaderGroups"]>;

/** What `table.getRowModel().rows` answers, for the body's prop. */
export type GridBodyRows = ReturnType<AppGridTable["getRowModel"]>["rows"];

/** The grid's own translator, bound to this package's namespace. */
export type GridTranslate = ReturnType<typeof useT<"grid">>["t"];

/** The subset of `AppGridProps` the wiring reads. */
export interface AppGridStateParams<TRow> {
  readonly columns: ColumnConfigMap<TRow>;
  readonly overrides?: ColumnOverrides<TRow> | undefined;
  readonly page?: Page<TRow> | undefined;
  readonly listState: ListQuerySearch;
  readonly onListStateChange: (next: ListQuerySearch) => void;
  readonly meta?: GridMeta<TRow> | undefined;
  readonly getRowId?: ((row: TRow) => string) | undefined;
  readonly capabilities?: GridCapabilities | undefined;
  readonly gridId?: string | undefined;
  readonly keyPrefix: string;
  readonly preferenceStorage?: PreferenceStorage | undefined;
}

/** Everything `app-grid.tsx` and its two regions render from. */
export interface AppGridState {
  /** This package's own copy (`useT("grid")`). */
  readonly t: GridTranslate;
  /**
   * The translator for the keys the **resource** wrote (`D7.4`). `t` above
   * resolves this component's own copy; this resolves the column headers,
   * filter labels and empty message a config handed down, whose namespace is
   * one `shared/grid` must never name (ADR-0032).
   */
  readonly tk: (key: TranslationKey) => string;
  readonly merged: ReturnType<typeof mergeColumns>;
  readonly movable: readonly string[];
  readonly preferences: GridPreferences;
  readonly preferenceStore: GridPreferencesStore;
  readonly rows: readonly GridRow[];
  readonly table: AppGridTable;
  readonly setColumnWidth: (columnId: string, width: number) => void;
  readonly clearColumnWidth: (columnId: string) => void;
  readonly menuEntries: readonly ColumnsMenuEntry[];
  readonly isDirty: boolean;
  readonly moveColumn: (columnId: string, direction: -1 | 1) => void;
  readonly reorderColumn: (activeId: string, overId: string) => void;
  readonly headerGroups: GridHeaderGroups;
  readonly bodyRows: GridBodyRows;
  readonly columnCount: number;
  readonly selectedIds: readonly string[];
  readonly clearSelection: () => void;
  readonly toolbarContext: GridToolbarContext;
  readonly onHotFilterChange: (field: string, next: readonly Filter[]) => void;
}

export const useAppGridState = <TRow = UnknownShape>({
  columns,
  overrides,
  page,
  listState,
  onListStateChange,
  meta,
  getRowId,
  capabilities,
  gridId,
  keyPrefix,
  preferenceStorage,
}: AppGridStateParams<TRow>): AppGridState => {
  const { t } = useT("grid");
  /*
   * The translator for the keys the **resource** wrote (`D7.4`). `useT("grid")`
   * above resolves this component's own copy; `tk` resolves the column headers,
   * filter labels and empty message a config handed down, whose namespace is
   * one `shared/grid` must never name (ADR-0032).
   */
  const tk = useKeyT();
  const merged = useMemo(
    () => mergeColumns(columns, overrides),
    [columns, overrides],
  );
  const filterable = useMemo(() => filterableColumns(merged), [merged]);

  /*
   * The resource's own columns and the grid's chrome, told apart once
   * (ADR-0041). Structural columns — ADR-0038's checkbox and the row-actions
   * column — are exempt from every preference **by construction**: `movable` is
   * what the store knows about, `structural` is pinned after it, and neither
   * list is something a validation rule has to keep honest.
   */
  const movable = useMemo(() => movableColumns(merged), [merged]);
  const structural = useMemo(() => structuralColumns(merged), [merged]);

  const [preferences, preferenceStore] = useGridPreferences({
    gridId,
    keyPrefix,
    movable,
    storage: preferenceStorage,
  });

  const selectable = capabilities?.selectable === true;

  /*
   * Selection is **ephemeral component state, not URL state**, and that is a
   * deliberate exception to ADR-0034's rule rather than a gap in it (ADR-0038
   * §Selection). That rule covers *view* state — offset, sort and filters
   * describe what the operator is looking at, and a link reproducing them
   * reproduces the view. A selection is *action context*: rows staged for
   * something about to happen. A URL carrying selected ids is neither shareable
   * nor restorable meaningfully — the recipient's fetched page may not contain
   * the rows, the rows may no longer exist, and "here is my half-staged delete"
   * is not a view anyone should be able to link to.
   *
   * Within the screen it survives page and filter navigation, and `getRowId` is
   * what makes that honest: the keys are resource ids, so paging away and back
   * finds the same rows selected. Leaving the screen discards it, which is what
   * ephemeral means.
   */
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  /*
   * The one place the row type is erased.
   *
   * `shared/grid` may hold no domain knowledge (ADR-0032), so the registry's
   * cell renderers take an `unknown` row — but a feature declaring
   * `onSelect: (staff) => …` should get `StaffResource`, not a cast at every
   * call site. Erasing once, here, is what buys that: the machinery is generic
   * at its door and untyped only on the inside.
   */
  const cellMeta = (meta ?? {}) as unknown as GridMeta<unknown>;

  /*
   * Deliberately independent of `meta`: the renderers read handlers from
   * `table.options.meta` at render time, so a caller may pass an inline
   * `meta={{ rowActions: [...] }}` without rebuilding every column def.
   */
  const tableColumns = useMemo(() => {
    const built = buildColumns(columns, overrides, tk);

    return selectable ? [buildSelectionColumn(), ...built] : built;
  }, [columns, overrides, selectable, tk]);

  const rows = (page?.items ?? NO_ROWS) as readonly GridRow[];

  const sorting = useMemo(
    () => toSortingState(listState.sort),
    [listState.sort],
  );
  const columnFilters = useMemo(
    () => toColumnFiltersState(listState.filters, filterable),
    [listState.filters, filterable],
  );
  /*
   * The engine's three ergonomics slices, composed from the store.
   *
   * `columnOrder` is the whole table's, so the structural columns are put back
   * around the operator's arrangement here — selection first, actions last —
   * which is what makes their position a property of this component rather than
   * of any resource's config, and what makes them unmovable without a rule
   * saying so.
   */
  const columnOrder = useMemo<ColumnOrderState>(
    () => [
      ...(selectable ? [SELECTION_COLUMN_ID] : []),
      ...preferences.order,
      ...structural,
    ],
    [selectable, preferences.order, structural],
  );

  /*
   * Absent means visible, so only the hidden ones are named. Storing the
   * negative is what makes a column added to the config tomorrow arrive
   * *visible* rather than inheriting a stale `true` nobody wrote.
   */
  const columnVisibility = useMemo<ColumnVisibilityState>(
    () => Object.fromEntries(preferences.hidden.map((id) => [id, false])),
    [preferences.hidden],
  );

  const pagination = useMemo<PaginationState>(
    () => ({
      pageIndex: Math.floor(listState.offset / listState.limit),
      pageSize: listState.limit,
    }),
    [listState.offset, listState.limit],
  );

  const onSortingChange: OnChangeFn<SortingState> = (updater) => {
    const next = typeof updater === "function" ? updater(sorting) : updater;

    onListStateChange(withSort(listState, fromSortingState(next)));
  };

  const onColumnFiltersChange: OnChangeFn<ColumnFiltersState> = (updater) => {
    const next =
      typeof updater === "function" ? updater(columnFilters) : updater;

    onListStateChange(
      withFilters(
        listState,
        filterable.map(([field]) => field),
        fromColumnFiltersState(next, filterable),
      ),
    );
  };

  /*
   * The third writer of the same state (ADR-0039). Its `owned` is the one field
   * it presses on, so a stance never touches a filter it did not put there —
   * the same rule `withFilters` keeps for the column controls, applied one
   * field at a time.
   */
  const onHotFilterChange = (field: string, next: readonly Filter[]) => {
    onListStateChange(withFilters(listState, [field], next));
  };

  /*
   * The three ergonomics handlers, and they all narrow to `movable` on the way
   * in. The engine reports the whole table's state — selection column, actions
   * column and all — and the store is only ever told about the resource's own
   * columns, so a structural id cannot reach storage even if something upstream
   * offered one.
   */
  const onColumnOrderChange: OnChangeFn<ColumnOrderState> = (updater) => {
    const next = typeof updater === "function" ? updater(columnOrder) : updater;

    preferenceStore.set({
      ...preferences,
      order: next.filter((id) => movable.includes(id)),
    });
  };

  const onColumnVisibilityChange: OnChangeFn<ColumnVisibilityState> = (
    updater,
  ) => {
    const next =
      typeof updater === "function" ? updater(columnVisibility) : updater;

    preferenceStore.set({
      ...preferences,
      hidden: movable.filter((id) => next[id] === false),
    });
  };

  const onColumnSizingChange: OnChangeFn<ColumnSizingState> = (updater) => {
    const next =
      typeof updater === "function" ? updater(preferences.sizing) : updater;

    preferenceStore.set({
      ...preferences,
      sizing: Object.fromEntries(
        Object.entries(next).filter(([id]) => movable.includes(id)),
      ),
    });
  };

  const onPaginationChange: OnChangeFn<PaginationState> = (updater) => {
    const next = typeof updater === "function" ? updater(pagination) : updater;

    onListStateChange(
      next.pageSize === listState.limit
        ? withOffset(listState, next.pageIndex * next.pageSize)
        : withLimit(listState, next.pageSize),
    );
  };

  const table = useTable<GridFeatures, GridRow>({
    features: gridFeatures,
    data: rows,
    columns: tableColumns,
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    // Spread rather than `?? undefined`: under `exactOptionalPropertyTypes` an
    // explicit `undefined` is not the same as an absent option, and `total` is
    // legitimately `null` for an endpoint that opted out of counting.
    ...(page?.total === undefined || page.total === null
      ? {}
      : { rowCount: page.total }),
    state: {
      sorting,
      columnFilters,
      pagination,
      rowSelection,
      /*
       * ADR-0041's three, controlled from the preferences store exactly as the
       * three above are controlled from the URL. "The table owns nothing
       * durable" is the taxonomy's third clause, and this object is where it
       * is true or false.
       */
      columnOrder,
      columnVisibility,
      columnSizing: preferences.sizing,
    },
    onSortingChange,
    onColumnFiltersChange,
    onPaginationChange,
    onColumnOrderChange,
    onColumnVisibilityChange,
    onColumnSizingChange,
    onRowSelectionChange: setRowSelection,
    /*
     * Registered unconditionally (`features.ts` says why) but only *enabled*
     * where the capability asked for it — so a resource that declares no
     * selection cannot acquire one through a stale state object or a stray
     * `toggleSelected`.
     */
    enableRowSelection: selectable,
    meta: cellMeta,
    /*
     * Always set. Without it TanStack falls back to the row *index*, which
     * makes `key={row.id}` positional — so React reuses row 3's DOM for a
     * different account after a delete, and an open menu or a focused control
     * ends up attached to the wrong row. Every resource in this API has an
     * `id` (ADR-0012), and a caller whose rows do not can say so.
     */
    getRowId: (row: GridRow) =>
      getRowId === undefined ? String(row["id"]) : getRowId(row as TRow),
  });

  /*
   * The stranded offset (ADR-0035).
   *
   * Deletions shrink the dataset below the page the operator is on; the API
   * answers an empty `items` with the true `total`, and without this they are
   * left staring at a blank grid that looks exactly like "everything is gone".
   * Repairing it as a navigation rather than by clamping the request keeps the
   * URL and the screen agreeing about which page this is.
   */
  useEffect(() => {
    if (page === undefined || !isStranded(page, listState.offset)) return;

    onListStateChange(
      withOffset(listState, lastPageOffset(page.total ?? 0, listState.limit)),
    );
    // Reacting to the page that arrived; re-running on a new `onListStateChange`
    // identity would fire the same navigation twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, listState.offset, listState.limit]);

  /*
   * The resize drag, **owned here rather than taken from v9** (ADR-0041,
   * amended `D4.5`).
   *
   * `columnResizingFeature` ships `header.getResizeHandler()`, and its start
   * width is `column.getSize()` — which for a column nobody has sized yet is the
   * engine's 150px default, while this grid's real default is "whatever the
   * content needed". Using it would snap a wide email column to 150px on the
   * first pixel of the first drag, before tracking the pointer at all. Reading
   * the start width off the header cell instead keeps auto-layout for every
   * untouched column and costs the fifteen lines below.
   *
   * It still writes through `table.setColumnSizing`, so the path in and out is
   * the one every other control takes: engine reports, `onColumnSizingChange`
   * translates, the store owns.
   */
  const setColumnWidth = useCallback(
    (columnId: string, width: number) => {
      table.setColumnSizing((current) => ({
        ...current,
        [columnId]: clampColumnWidth(width),
      }));
    },
    [table],
  );

  const clearColumnWidth = useCallback(
    (columnId: string) => {
      table.setColumnSizing((current) => {
        const { [columnId]: _dropped, ...rest } = current;

        return rest;
      });
    },
    [table],
  );

  const menuEntries = useMemo(
    () =>
      preferences.order.map((id) => ({
        id,
        label: labelOf(merged, id, tk),
        isVisible: !preferences.hidden.includes(id),
      })),
    [preferences.order, preferences.hidden, merged, tk],
  );

  /*
   * Whether anything deviates from the config, which is the only thing "Reset
   * to defaults" could act on. Order is compared as a sequence because
   * reordering changes nothing else about it.
   */
  const isDirty =
    Object.keys(preferences.sizing).length > 0 ||
    preferences.hidden.length > 0 ||
    preferences.order.join("\n") !== movable.join("\n");

  /**
   * One column, from one index to another — the single path both reorder
   * gestures take (`D10.3`).
   *
   * The arrows and the drag handle differ only in how they name the
   * destination: an arrow says "one place that way", a drop says "where this
   * other column is". Both end here, so ADR-0041's promise that order is a
   * preference like any other holds for the new gesture without a second
   * writer existing to disagree with the first.
   */
  const reorderTo = useCallback(
    (from: number, to: number) => {
      if (from === -1 || to < 0 || to >= preferences.order.length) return;

      const next = [...preferences.order];
      const [moved] = next.splice(from, 1);

      if (moved === undefined) return;
      next.splice(to, 0, moved);

      /*
       * Through the engine, not around it: `setColumnOrder` lands in
       * `onColumnOrderChange`, which is where the structural ids are stripped —
       * so the menu never has to know they exist.
       */
      table.setColumnOrder([
        ...(selectable ? [SELECTION_COLUMN_ID] : []),
        ...next,
        ...structural,
      ]);
    },
    [preferences.order, table, selectable, structural],
  );

  const moveColumn = useCallback(
    (columnId: string, direction: -1 | 1) => {
      const from = preferences.order.indexOf(columnId);

      reorderTo(from, from + direction);
    },
    [preferences.order, reorderTo],
  );

  /**
   * A drag landed on another row (`D10.3`, ADR-0052 §Visible state).
   *
   * Ids in, indices resolved *here* against the order the preference holds
   * right now — the menu renders that order but does not own it, and by the
   * time this runs the two could differ (a second grid on the same `gridId`,
   * a settings sync landing mid-gesture). Resolving late is what keeps a drop
   * meaning "put it where that column is" rather than "put it at the number
   * the menu last saw".
   */
  const reorderColumn = useCallback(
    (activeId: string, overId: string) => {
      reorderTo(
        preferences.order.indexOf(activeId),
        preferences.order.indexOf(overId),
      );
    },
    [preferences.order, reorderTo],
  );

  const headerGroups = table.getHeaderGroups();
  const bodyRows = table.getRowModel().rows;
  /*
   * The *visible* leaf columns, since `D4.5` — a `colSpan` counted from the
   * config would over-span the moment an operator hides a column, and the
   * empty, loading and error rows would push the table wider than its own
   * header.
   */
  const columnCount = table.getVisibleLeafColumns().length;

  /*
   * The selection as ids rather than as the engine's state object, because that
   * is what every consumer of it wants — `Promise.allSettled(ids.map(delete))`,
   * a count, a confirm's copy. They are resource ids, so the list answers for
   * rows the current page no longer holds, which is the whole point of keying
   * by id.
   *
   * Read off the state this component controls rather than through
   * `table.getSelectedRowIds()`, which is the same `Object.keys` and returns a
   * fresh array on every call: memoising on the state gives the toolbar context
   * a stable identity between selections instead of a new one per render.
   */
  const selectedIds = useMemo<readonly string[]>(
    () =>
      selectable
        ? /*
           * Filtered on the value rather than taken as `Object.keys`.
           *
           * `RowSelectionState` is `Record<string, true>` and v9 `delete`s a key
           * on deselection, so the two are identical today — its own
           * `getSelectedRowIds` is the bare `Object.keys`. What this feeds is
           * deletion, and "key present" standing in for "selected" is an
           * encoding a minor release could revise. The filter costs nothing and
           * removes the coupling.
           */
          Object.entries(rowSelection)
            .filter(([, on]) => on === true)
            .map(([id]) => id)
        : EMPTY_IDS,
    [selectable, rowSelection],
  );
  const clearSelection = useCallback(() => {
    setRowSelection({});
  }, []);
  const toolbarContext = useMemo<GridToolbarContext>(
    () => ({ selectedIds, clearSelection }),
    [selectedIds, clearSelection],
  );

  return {
    t,
    tk,
    merged,
    movable,
    preferences,
    preferenceStore,
    rows,
    table,
    setColumnWidth,
    clearColumnWidth,
    menuEntries,
    isDirty,
    moveColumn,
    reorderColumn,
    headerGroups,
    bodyRows,
    columnCount,
    selectedIds,
    clearSelection,
    toolbarContext,
    onHotFilterChange,
  };
};

/**
 * A column's header as words, for the two menus that name a column rather than
 * render it.
 *
 * It reads the *config*'s key rather than the built `ColumnDef`'s resolved
 * header, so there is one place a header becomes a sentence per render and no
 * `String()` over a value that might be a React node.
 */
const labelOf = (
  columns: readonly (readonly [string, { readonly header: TranslationKey }])[],
  id: string,
  t: (key: TranslationKey) => string,
): string => {
  const header = columns.find(([name]) => name === id)?.[1].header;

  return header === undefined ? id : t(header);
};

/**
 * A stored width, read as an **own** property.
 *
 * `sizing` is a plain object, so a resource whose column is called `constructor`
 * or `toString` would otherwise read a *function* off the prototype chain —
 * which passes the `undefined` test and reaches a `style`. Not reachable from
 * storage, where `reconcile` filters to declared ids; reachable from a config,
 * which is exactly the kind of thing a config is allowed to contain.
 *
 * It lives beside the preferences it reads rather than in either region,
 * because both regions read it: the header sizes its cells and its inner
 * block, and the body sizes the cell under each of them.
 */
export const widthOf = (
  preferences: { readonly sizing: Readonly<Record<string, number>> },
  columnId: string,
): number | undefined =>
  Object.hasOwn(preferences.sizing, columnId)
    ? preferences.sizing[columnId]
    : undefined;
