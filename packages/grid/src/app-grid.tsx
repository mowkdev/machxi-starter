import {
  DEFAULT_GRID_DENSITY,
  type Filter,
  type GridDensity,
  type ListQuerySearch,
  type Page,
} from "@repo/contracts";
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
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useKeyT, useT, type TranslationKey } from "@repo/i18n";
import { mergeColumns } from "@repo/resource";
import type {
  ColumnConfigMap,
  ColumnOverrides,
  GridCapabilities,
  HotFilterConfig,
} from "@repo/resource";
import { Button } from "@repo/ui/components/button";
import { Skeleton } from "@repo/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
import { cn } from "@repo/ui/lib/utils";

import { AppliedFilters } from "./applied-filters";
import {
  DENSITY_CELL_X,
  DENSITY_ROW_HEIGHT,
  GridDensityProvider,
} from "./density";
import {
  filterableColumns,
  fromColumnFiltersState,
  toColumnFiltersState,
  type ColumnFilterValue,
} from "./column-filters";
import { ColumnsMenu } from "./columns-menu";
import {
  SELECTION_COLUMN_ID,
  buildColumns,
  buildSelectionColumn,
  movableColumns,
  structuralColumns,
  type GridRow,
} from "./columns";
import { gridFeatures } from "./features";
import { ColumnFilterDialog } from "./filter-dialog";
import { GridPager } from "./grid-pager";
import { GridToolbar } from "./grid-toolbar";
import {
  clearedFilters,
  fromSortingState,
  isStranded,
  lastPageOffset,
  toSortingState,
  withFilters,
  withLimit,
  withOffset,
  withSearch,
  withSort,
  withoutFilter,
} from "./list-state";
import {
  MIN_COLUMN_WIDTH,
  clampColumnWidth,
  type PreferenceStorage,
} from "./preferences";
import type { GridMeta, GridToolbarContext } from "./types";
import { useGridPreferences } from "./use-grid-preferences";

/**
 * The config-driven grid (ADR-0035).
 *
 * A resource declares its columns as data; this renders them, with
 * `@repo/ui`'s `Table` primitives as the markup and TanStack Table as the
 * headless engine. Two properties are the design, and everything else follows
 * from them:
 *
 * **The engine computes nothing.** `manualSorting` / `manualFiltering` /
 * `manualPagination` are all on, no row model that could sort, filter or
 * paginate is even imported (see `features.ts`), and `rowCount` comes from the
 * envelope's own `meta.pagination.total`. A header click does not reorder the
 * rows in hand — it reports a new state, the URL changes, the list query
 * refetches, and the server's ordering is what renders. That is the honesty the
 * design requires: a grid that sorted its visible page while implying it sorted
 * the dataset would be lying to the operator.
 *
 * **The URL is the state.** Every control here reports through
 * `onListStateChange` and none of them holds state of its own; the caller
 * navigates, the new search comes back down as `listState`, and the grid
 * renders it. So a view is always a link, back and forward walk table states,
 * and the cache falls out correctly because the same URL is the same query key
 * (ADR-0034).
 */

/*
 * Every optional prop admits an explicit `undefined`, because the repository
 * runs `exactOptionalPropertyTypes` and the natural call site is
 * `page={query.data}` — a value that is legitimately `undefined` while the
 * first page loads. Without the annotation every consumer would have to spread
 * conditionally, which is ceremony in the layer this machinery exists to keep
 * thin.
 */
export interface AppGridProps<TRow> {
  /** The resource's columns (ADR-0035). */
  readonly columns: ColumnConfigMap;
  /** Per-usage adjustments — headers, hidden columns — merged over the above. */
  readonly overrides?: ColumnOverrides | undefined;
  /** The page in hand. `undefined` while the first one is loading. */
  readonly page?: Page<TRow> | undefined;
  /**
   * Why there is no page, if the list query failed.
   *
   * ADR-0034 keeps queries silent by default, and the reason it gives is that
   * "a failed read usually has somewhere better to show itself — an empty grid,
   * an error panel in the place the data would have been". This is that place.
   * Without it a `403` from the segment's `authorize` mount, a `500` or a dead
   * socket renders as loading rows that never resolve — the retry policy
   * short-circuits a `4xx`, so nothing ever arrives to replace them — and the
   * one refusal the client deliberately does not pre-guess reaches the operator
   * as no message at all.
   */
  readonly error?: unknown;
  /** Lets the error row offer another attempt rather than only an apology. */
  readonly onRetry?: (() => void) | undefined;
  /**
   * What the error row renders (`D9.4`, ADR-0051).
   *
   * **A slot rather than a component this package imports**, because the panel
   * it replaced — the admin's `QueryError` — turns an unknown into a sentence
   * through that app's `shared/notifications` and its `errors` catalogue, and
   * both are the app's. A package that rendered one would be naming copy it
   * does not own (ADR-0046 §13).
   *
   * Required, deliberately: a grid that swallowed a refused list and showed an
   * empty table would be the failure ADR-0043 built the panel to prevent, so
   * a second consumer has to answer this rather than inherit a silent default.
   * `apps/admin`'s door binds it, so no call site in that app passes it.
   */
  readonly renderError: (props: {
    readonly error: unknown;
    readonly onRetry?: (() => void) | undefined;
  }) => ReactNode;
  /** The validated search params the route owns (ADR-0034). */
  readonly listState: ListQuerySearch;
  readonly onListStateChange: (next: ListQuerySearch) => void;
  /** Handlers the registry's cell renderers reach through `table.options.meta`. */
  readonly meta?: GridMeta<TRow> | undefined;
  /** Stable row identity. Defaults to an `id` field, which every resource has. */
  readonly getRowId?: ((row: TRow) => string) | undefined;
  /** Whether the endpoint implements ADR-0014's `q` search. */
  readonly searchable?: boolean | undefined;
  /**
   * The stances this resource offers one press away (ADR-0039, `D4.4`).
   *
   * A prop rather than a member of {@link capabilities}, deliberately: ADR-0042
   * narrows *capabilities* by the operator's role, and a hot filter is a filter
   * — nobody's role decides whether a list may be narrowed. The screen hands it
   * straight from `config.grid.hotFilters`, the way it hands `columns`.
   */
  readonly hotFilters?: readonly HotFilterConfig[] | undefined;
  readonly isFetching?: boolean | undefined;
  /**
   * Shown in place of rows when the page is empty.
   *
   * A **key** since `D7.4` (ADR-0046 §7), resolved here like every other piece
   * of copy a screen hands the machinery: the sentence belongs to the resource
   * ("No staff match this view.") and the namespace it lives in is the
   * resource's, so this component resolves it without learning which resource
   * it is. Absent falls back to the grid's own `grid:empty`, which is what
   * `D7.2` gave it and what a screen that wrote nothing still gets.
   */
  readonly emptyMessage?: TranslationKey | undefined;
  /**
   * What this resource's grid surface offers (ADR-0038), already narrowed by
   * the operator's role (ADR-0042) — the screen conjoins the two once, above
   * here, so this component never learns a resource's name.
   *
   * Absent is the safe default: a plain read-only grid.
   */
  readonly capabilities?: GridCapabilities | undefined;
  /**
   * The Create affordance, rendered in the toolbar when `canCreate`.
   *
   * **`ReactNode` rather than ADR-0038's `onCreate: () => void`, amended at
   * `D4.3`.** The ADR was written the same day as ADR-0040 and did not account
   * for what that one decided: composing a record is addressable state, so
   * Create is a `<Link>` and its role is the assertion — a `() => void` handler
   * can only produce a `<button>`, which would undo D4.2's property that the
   * entry point survives a middle-click, a copy-link and a reload. The
   * capability still decides *whether*; the page supplies *what*, which is the
   * same division ADR-0038 already draws with `toolbarStart` / `toolbarEnd`.
   */
  readonly createAction?: ReactNode;
  /**
   * Runs the bulk delete over the selected ids (ADR-0038's fan-out).
   *
   * **The second parameter is an amendment to ADR-0038 made at `D4.3`.** The
   * ADR writes `onBulkDelete?: (ids: readonly string[]) => void` and also says
   * "selection clears when the fan-out settles" — and with the selection state
   * held here, in the machinery, the caller had no way to do the second thing.
   * Handing it the same {@link GridToolbarContext} the toolbar already gets is
   * the smallest fix: no new type, the state stays out of every page, and the
   * feature that consumes a selection is the thing that ends it.
   */
  readonly onBulkDelete?:
    ((ids: readonly string[], context: GridToolbarContext) => void) | undefined;
  /** Appended after the toolbar's defaults, on the left. */
  readonly toolbarStart?: ReactNode;
  /** Appended after the toolbar's defaults, on the right. */
  readonly toolbarEnd?: ReactNode;
  /**
   * Replaces the toolbar region outright.
   *
   * Precedence is pinned: **`renderToolbar` wins and the slots are then
   * ignored.** Composing the two would make "what is in this toolbar" a
   * question with two answers.
   */
  readonly renderToolbar?:
    ((context: GridToolbarContext) => ReactNode) | undefined;
  /**
   * Which grid's arrangement this is, for ADR-0041's preferences store.
   *
   * `ResourceConfig.name` at every call site — the prop exists so a second grid
   * over the same resource can say otherwise, because two grids sharing an id
   * would fight over one entry and each would restore the other's layout.
   * **Absent means nothing persists**: sizing, order and visibility still work
   * for the life of the component, they simply have nowhere to be written.
   */
  readonly gridId?: string | undefined;
  /**
   * The device-key prefix this app owns, `${appId}.${segment}`
   * (ADR-0064 §1).
   *
   * Required, and bound once by the app's `shared/grid` door rather than
   * passed per screen — the same move that door already makes for
   * `renderError` and the density, and for the same reason: the brand belongs
   * to the app, and a prop each page remembered to pass would be a key that
   * differed by page. It is required rather than defaulted because a package
   * default would be a brand this package holds.
   */
  readonly keyPrefix: string;
  /**
   * The storage adapter (ADR-0041), defaulting to `localStorage`.
   *
   * This is the seam the ADR is built around rather than a test hook: the
   * future server-backed user-settings adapter arrives *here*, as a third
   * implementation of three functions, and neither this component nor the store
   * changes when it does. Tests pass an in-memory one, which is the same fact
   * from the other side.
   *
   * **It must be referentially stable.** The store is memoised on this value,
   * so an adapter constructed inline in the caller's JSX — `storage={createX()}`
   * — rebuilds the store every render, and a store rebuilt every render hands
   * `useSyncExternalStore` a new snapshot every render, which is an infinite
   * loop rather than a slow path. Module scope, a `useMemo` or a ref; the
   * default is a module-level decision and has the property for free.
   */
  readonly preferenceStorage?: PreferenceStorage | undefined;
  /**
   * Page-size options for the pager; the pager's own defaults when absent.
   *
   * Kept as a prop *and* readable from `capabilities.pageSizes`, with the
   * capability winning: the resource is where a page size is declared, and this
   * stays for a usage that needs to differ from its resource.
   */
  readonly pageSizes?: readonly number[] | undefined;
  /**
   * Alternate the body rows' background (ADR-0052 §Visible state, `D10.2`).
   *
   * **A prop and not a preference, off by default.** Zebra striping is a
   * presentation choice a page makes about its own density — it says nothing
   * about what the operator is looking at, so ADR-0041's taxonomy puts it
   * nowhere: not in the URL (it is not view state a link should carry), not in
   * preferences (it is not the operator's ergonomics), and not in the table
   * (which owns nothing durable). It is an argument, like `searchable`.
   *
   * Off by default because every shipped screen is unstriped today and a
   * default that changed them all would be this prop deciding for pages that
   * never asked.
   */
  readonly striped?: boolean | undefined;
  /**
   * How tightly the rows are packed (`D11.6`, ADR-0053 §2, ADR-0054 §6).
   *
   * **A prop, and the account fact behind it is the app's to hold.** The mode
   * is an account setting — one row in `settings`, written through ADR-0045's
   * coalescing writer — and this package may not know a settings resource
   * exists. So the app reads the fact and passes it, the way it passes
   * `listState`; what the table owns is only what a density *is*.
   *
   * `DEFAULT_GRID_DENSITY` when absent, which is `"comfortable"` and is the
   * contract's constant rather than a literal of this package's.
   */
  readonly density?: GridDensity | undefined;
}

const NO_ROWS: readonly never[] = [];

/** One frozen empty array, so the default does not re-identify per render. */
const NO_HOT_FILTERS: readonly HotFilterConfig[] = Object.freeze([]);

/**
 * One frozen empty array for the not-selectable case.
 *
 * `getSelectedRowIds()` builds a fresh array per call, so a `[]` literal here
 * would give the toolbar context a new identity every render and defeat the
 * memo below for exactly the grids that have no selection to track.
 */
const EMPTY_IDS: readonly string[] = Object.freeze([]);

/**
 * What a sticky header costs on a collapsed-border table (ADR-0037, `D4.1`).
 *
 * Tailwind's preflight sets `border-collapse: collapse`, and under collapsed
 * borders Chrome does not carry a table *section*'s background along with a
 * sticky `thead`: the header text travels, its background stays behind, and
 * every row scrolls straight through the column labels. Found in the browser,
 * because nothing in jsdom and nothing in a class list says so.
 *
 * Separated borders with zero spacing fixes it, at one price the separated
 * model charges: borders on rows are not rendered, only borders on cells. So
 * the `border-b` that `@repo/ui`'s `TableRow` and `TableHeader` declare is
 * re-declared here on the cells, which is what keeps the table looking exactly
 * as it did. This lives in the grid rather than in the design system because it
 * is the sticky header's bill, not the `Table` primitive's — a table that does
 * not stick has nothing to pay.
 */
const STICKY_HEADER_TABLE = [
  "border-separate border-spacing-0",
  /*
   * The two rules are **different lines** since `D11.2` (ADR-0054 §4). The
   * header's bottom edge is `--border-strong` — it is the band rule that closes
   * the chrome above the rows, now that the card frame has retired and there is
   * no border box drawing that boundary. The rows' own rule is `--grid-rule`,
   * quieter than a hairline border on purpose: forty of them stacked is a
   * texture, not forty statements.
   */
  "[&_thead_th]:border-b [&_thead_th]:border-border-strong",
  "[&_thead_td]:border-b [&_thead_td]:border-border-strong",
  "[&_tbody_td]:border-b [&_tbody_td]:border-grid-rule",
  "[&_tbody_tr:last-child>td]:border-b-0",
].join(" ");

/**
 * A column head, in Instrument's caps (ADR-0054 §3/§4, `D11.2`).
 *
 * 11/16 at 600 with 0.07em tracking, upper-cased — the type role the record
 * gives column heads and group labels. It is spelled twice, on the `th` and on
 * the sort `Button`, because a button carries its own `text-sm` and
 * `font-medium` from the primitive's variants: `text-transform` and
 * `letter-spacing` inherit into it, size and weight do not.
 */
const HEADER_LABEL =
  "text-[11px] leading-4 font-semibold tracking-[0.07em] uppercase";

export const AppGrid = <TRow,>({
  density = DEFAULT_GRID_DENSITY,
  columns,
  overrides,
  page,
  error,
  onRetry,
  renderError,
  listState,
  onListStateChange,
  meta,
  getRowId,
  searchable = false,
  hotFilters = NO_HOT_FILTERS,
  isFetching = false,
  emptyMessage,
  capabilities,
  createAction = null,
  onBulkDelete,
  toolbarStart = null,
  toolbarEnd = null,
  renderToolbar,
  gridId,
  keyPrefix,
  preferenceStorage,
  pageSizes,
  striped = false,
}: AppGridProps<TRow>) => {
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

  const table = useTable<typeof gridFeatures, GridRow>({
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

  return (
    /*
     * The height budget (ADR-0037).
     *
     * `flex-1 min-h-0` on a column whose chrome is static and whose scroll body
     * takes the rest: the toolbar and the pager declare their heights, the rows
     * get whatever is left, and no dimension is written down anywhere — which
     * is the property a `calc(100vh - …)` would have traded away the first time
     * a sibling ADR changed the chrome's height.
     *
     * It is unconditional here and switched further up (`fullHeight` on the
     * page container). In a page that did not opt in, `flex-1` and `min-h-0`
     * are inert — the grid grows with its rows and the document scrolls — so
     * one component serves both strategies without a mode of its own.
     *
     * **The `gap-3` retired at `D11.4`** (ADR-0054 §5). The chrome is a stack
     * of bands now — toolbar 48, "Filtered by" 40, the rows, pager 48 — and a
     * band declares its own height; twelve pixels of nothing between each pair
     * is the card-era spacing that the bands replace, and it would put the
     * grid's regions out of register with the header and page-header bands
     * above them, which sit flush.
     */
    /*
     * The mode the cells render at (`D11.6`, ADR-0054 §6).
     *
     * A provider rather than a prop threaded downward, because the cell
     * renderers arrive through the registry (ADR-0035): a config carries the
     * key `"rolesList"` and the table instantiates what it names, so there is
     * no call site here to hand a badge its height. The two `cn` calls below
     * read `density` directly; only the registry's components need the
     * context.
     */
    <GridDensityProvider value={density}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/*
         * The toolbar (ADR-0038) — the third region ADR-0037's budget carries,
         * after the header rows and the pager, and static chrome like both.
         *
         * `renderToolbar` wins outright and the slots are then ignored; a screen
         * whose toolbar is genuinely bespoke replaces the region rather than
         * negotiating with it.
         */}
        {renderToolbar === undefined ? (
          <GridToolbar
            capabilities={capabilities}
            searchable={searchable}
            searchValue={listState.q ?? ""}
            onSearchCommit={(term) => {
              onListStateChange(withSearch(listState, term));
            }}
            hotFilters={hotFilters}
            filters={listState.filters}
            onHotFilterChange={onHotFilterChange}
            createAction={createAction}
            onBulkDelete={onBulkDelete}
            toolbarStart={toolbarStart}
            toolbarEnd={toolbarEnd}
            /*
             * `null`, not a component that renders nothing: the toolbar decides
             * whether the whole region exists by asking whether its slots were
             * *given* anything, and an element that returns `null` still counts
             * as given. A grid whose every column is structural would otherwise
             * get the empty band ADR-0038 spent a step removing.
             */
            columnsMenu={
              movable.length === 0 ? null : (
                <ColumnsMenu
                  entries={menuEntries}
                  isDirty={isDirty}
                  onToggle={(id, visible) => {
                    table.setColumnVisibility((current) => ({
                      ...current,
                      [id]: visible,
                    }));
                  }}
                  onMove={moveColumn}
                  onReorder={reorderColumn}
                  onReset={preferenceStore.reset}
                />
              )
            }
            selectedIds={selectedIds}
            clearSelection={clearSelection}
          />
        ) : (
          renderToolbar(toolbarContext)
        )}

        {/*
         * The applied-filters bar (ADR-0039) — the second static region of
         * ADR-0037's budget, and it renders nothing when nothing is applied.
         *
         * **It no longer takes `hotFilters`** (`D10.2`, ADR-0052 §Visible
         * state). It took them to suppress the chips a pressed button was
         * already displaying, which also meant this call site had to hand it
         * `NO_HOT_FILTERS` whenever a screen replaced the toolbar — or those
         * filters would have been displayed by nothing at all. With suppression
         * retired the whole question is gone: every applied filter has a chip
         * here, whoever drew the toolbar.
         */}
        <AppliedFilters
          filters={listState.filters}
          q={listState.q ?? ""}
          /*
           * `merged`, so a usage that *hid* a column has hidden its label too —
           * the same set that decides `owned` for the update channel decides the
           * words for the display one, which keeps it one rule instead of two.
           * ADR-0039 names exactly this case ("the deleted-only state arriving by
           * URL on a page whose overrides hid the column") as foreign, and a
           * friendly label on a filter with no control to open would be the bar
           * implying one.
           */
          columns={merged}
          onRemoveFilter={(filter) => {
            onListStateChange(withoutFilter(listState, filter));
          }}
          onRemoveSearch={() => {
            onListStateChange(withSearch(listState, ""));
          }}
          onClearAll={() => {
            onListStateChange(clearedFilters(listState));
          }}
        />

        {/*
         * The one scroll container (ADR-0037), on both axes, and the floor that
         * keeps a short viewport honest: when `min-h-64` wins, the column grows
         * past the viewport and the document scrolls — D3's behaviour, reached by
         * degrading rather than by crushing the grid to two rows.
         *
         * **The card frame retired at `D11.2`** (ADR-0054 §4). The pane carried
         * `rounded-md border bg-card` — a border box around the table, which is
         * exactly the frame Instrument replaces with band rules: the table runs
         * edge to edge inside the inset, the header's own `--border-strong`
         * bottom rule closes the chrome above it, and the ground is whatever the
         * pane is mounted in rather than a second surface colour inside it. The
         * sticky header keeps an opaque ground of its own (`--grid-header`),
         * which is what rows pass *under*; it no longer has to agree with a
         * background this element paints.
         */}
        <div
          data-slot="grid-scroll"
          className="scrollbar-thin min-h-64 w-full min-w-0 flex-1 overflow-auto"
        >
          <Table container={false} className={STICKY_HEADER_TABLE}>
            {/*
             * Sticky within the scroll body — the point of the budget. It carries
             * an opaque background so rows pass *under* the header rather than
             * through it, and a stacking order, because ADR-0039's filter
             * popovers and ADR-0038's row menus will float in this same
             * container and have to layer against it knowingly. The opaque
             * background is on the cells rather than on the `thead`, for the
             * reason `STICKY_HEADER_TABLE` above records — and since `D11.2` that
             * background is `--grid-header`, the header band's own ground rather
             * than the card's (ADR-0054 §4).
             */}
            <TableHeader className="sticky top-0 z-10 [&_td]:bg-grid-header [&_th]:bg-grid-header">
              {headerGroups.map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const sorted = header.column.getIsSorted();
                    const align =
                      header.column.columnDef.meta?.align ?? "start";
                    const filter = header.column.columnDef.meta?.filter;

                    const width = widthOf(preferences, header.column.id);

                    return (
                      <TableHead
                        key={header.id}
                        /*
                         * `relative` so the resize handle can sit on the edge —
                         * and, since `D11.2`, the header band's own geometry
                         * (ADR-0054 §4): 34px tall against the primitive's 40,
                         * with the caps label and the body's own horizontal
                         * padding — the height is the header's and the padding
                         * is the column's, so Compact moves one and not the
                         * other (ADR-0054 §6, `D11.6`).
                         */
                        className={cn(
                          "relative h-[34px]",
                          DENSITY_CELL_X[density],
                          HEADER_LABEL,
                          align === "end" && "text-right",
                        )}
                        style={width === undefined ? undefined : { width }}
                        aria-sort={
                          sorted === false
                            ? undefined
                            : sorted === "asc"
                              ? "ascending"
                              : "descending"
                        }
                      >
                        {/*
                         * Sort control and filter icon, side by side (ADR-0039).
                         * Sorting is untouched — a header click still toggles it —
                         * and the filter icon is a sibling rather than something
                         * inside the sort button, which would be a button in a
                         * button.
                         */}
                        <div
                          className={cn(
                            "flex items-center gap-1",
                            align === "end" && "justify-end",
                            width !== undefined && "overflow-hidden",
                          )}
                          /*
                           * The width lives on an inner block as well as on the
                           * cell, and that is what makes sizing bite at all.
                           * `@repo/ui`'s `TableHead` and `TableCell` are
                           * `whitespace-nowrap`, and under `table-layout: auto` a
                           * cell's own `width` is a suggestion its content can
                           * overrule — so a narrowed column would simply refuse
                           * to narrow. A fixed-width block inside it cannot.
                           */
                          style={
                            width === undefined
                              ? undefined
                              : { width, maxWidth: width }
                          }
                        >
                          {header.column.getCanSort() ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              /*
                               * `text-[11px] font-semibold` restated from
                               * {@link HEADER_LABEL}: the button variant sets
                               * both, and the two properties that *do* inherit
                               * — the caps and the tracking — arrive from the
                               * `th` on their own. `h-7` so a 34px band holds it.
                               */
                              className="-ml-2.5 h-7 text-[11px] font-semibold data-[state=open]:bg-accent"
                              onClick={header.column.getToggleSortingHandler()}
                            >
                              <table.FlexRender header={header} />
                              {sorted === "asc" ? (
                                <ArrowUpIcon aria-hidden />
                              ) : sorted === "desc" ? (
                                <ArrowDownIcon aria-hidden />
                              ) : (
                                <ChevronsUpDownIcon
                                  aria-hidden
                                  className="opacity-50"
                                />
                              )}
                            </Button>
                          ) : (
                            <table.FlexRender header={header} />
                          )}

                          {filter === undefined ? null : (
                            <ColumnFilterDialog
                              field={header.column.id}
                              label={String(
                                header.column.columnDef.header ??
                                  header.column.id,
                              )}
                              config={filter}
                              /*
                               * Committed through the engine, not around it: the
                               * dialog's Apply is `setFilterValue`, which lands in
                               * `onColumnFiltersChange` above and navigates. One
                               * path in and out, the same one the deleted row used.
                               */
                              value={
                                header.column.getFilterValue() as
                                  ColumnFilterValue | undefined
                              }
                              onCommit={(next) => {
                                header.column.setFilterValue(next);
                              }}
                            />
                          )}
                        </div>

                        {header.column.columnDef.meta?.structural ===
                        true ? null : (
                          <ResizeHandle
                            label={String(
                              header.column.columnDef.header ??
                                header.column.id,
                            )}
                            width={width}
                            onResize={(next) => {
                              setColumnWidth(header.column.id, next);
                            }}
                            onReset={() => {
                              clearColumnWidth(header.column.id);
                            }}
                          />
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>

            <TableBody>
              {page === undefined && error !== undefined && error !== null ? (
                /*
                 * A failure, in the place the rows would have been. It wins over
                 * the loading branch because a query that failed is not loading —
                 * `keepPreviousData` means a *refetch* failure still has a page
                 * to render, and that case deliberately keeps showing it rather
                 * than replacing an operator's view with an apology.
                 */
                <TableRow>
                  <TableCell colSpan={columnCount} className="h-24 text-center">
                    {renderError({ error, onRetry })}
                  </TableCell>
                </TableRow>
              ) : page === undefined ? (
                <LoadingRows columns={columnCount} density={density} />
              ) : bodyRows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={columnCount}
                    className="h-24 text-center text-muted-foreground"
                  >
                    {emptyMessage === undefined ? t("empty") : tk(emptyMessage)}
                  </TableCell>
                </TableRow>
              ) : (
                bodyRows.map((row) => (
                  /*
                   * `even:` rather than an index off `bodyRows`: the stripe is a
                   * property of a row's *position on screen*, and the DOM is
                   * where that is known — a computed index would have to be kept
                   * honest against every future branch that renders a row (the
                   * loading, empty and error rows above are all `<TableRow>`
                   * too), while the selector cannot drift from what is rendered.
                   *
                   * `bg-grid-stripe` since `D11.2` — a solid token rather than
                   * `bg-muted/30`, because ADR-0054 §2 made the dark theme's
                   * surfaces an elevation ramp and an alpha stripe reads as a
                   * different colour over each rung of it. It sits under
                   * `TableRow`'s own `hover:bg-muted/50` and the selected state
                   * below, both of which sort after `even` in Tailwind's variant
                   * order and therefore still win: a striped row must not stop
                   * answering the pointer or stop showing that it is selected.
                   *
                   * **Selection is `--primary-tint` plus a 2px inset bar**
                   * (ADR-0054 §4), and the bar is drawn on the row's first cell
                   * rather than on the `<tr>`: the table is `border-separate`
                   * (see {@link STICKY_HEADER_TABLE}) and a row-level shadow in
                   * the separated model is the same promise a row-level *border*
                   * turned out not to keep at `D4.1`. A cell keeps it.
                   */
                  <TableRow
                    key={row.id}
                    className={cn(
                      striped && "even:bg-grid-stripe",
                      "data-[state=selected]:bg-primary-tint",
                      "data-[state=selected]:[&>td:first-child]:shadow-[inset_2px_0_0_var(--primary)]",
                    )}
                  >
                    {/*
                     * `getVisibleCells`, not `getAllCells` — since `D4.5` a
                     * column can be hidden, and a row that rendered every cell
                     * would put its data under the wrong headers.
                     */}
                    {row.getVisibleCells().map((cell) => {
                      const width = widthOf(preferences, cell.column.id);

                      return (
                        <TableCell
                          key={cell.id}
                          /*
                           * The row band (ADR-0054 §4, §6): 44px Comfortable
                           * or 34px Compact, with the matching 10/8 horizontal
                           * padding and its 13/18 cell type. The vertical
                           * padding goes to zero because the height is now
                           * declared rather than summed out of `p-2`.
                           */
                          className={cn(
                            DENSITY_ROW_HEIGHT[density],
                            DENSITY_CELL_X[density],
                            "py-0 text-[13px] leading-[18px]",
                            cell.column.columnDef.meta?.mono === true &&
                              "font-mono",
                            cell.column.columnDef.meta?.align === "end" &&
                              "text-right",
                          )}
                          style={width === undefined ? undefined : { width }}
                        >
                          {/*
                           * Unsized columns render exactly as they did — no
                           * wrapper, no constraint, content-width auto layout.
                           * Only a column somebody has actually sized gets the
                           * fixed-width block that makes the number real.
                           */}
                          {width === undefined ? (
                            <table.FlexRender cell={cell} />
                          ) : (
                            <div
                              className="overflow-hidden text-ellipsis"
                              style={{ width, maxWidth: width }}
                            >
                              <table.FlexRender cell={cell} />
                            </div>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/*
         * The pager reports through the engine rather than around it, so
         * `onPaginationChange` above is the single path a page change takes —
         * the same loop a header click takes through `onSortingChange`. Its last
         * page is `getPageCount()`, which is derived from the `rowCount` the
         * envelope's `meta.pagination.total` supplied; `null` says the endpoint
         * did not count and there is no last page to offer.
         */}
        <GridPager
          offset={listState.offset}
          limit={listState.limit}
          total={page?.total ?? null}
          rowCount={rows.length}
          lastOffset={
            page?.total === undefined || page.total === null
              ? null
              : Math.max(0, (table.getPageCount() - 1) * listState.limit)
          }
          // The resource declares it (ADR-0038); the prop is the per-usage
          // override, and the pager's own defaults are the floor under both.
          pageSizes={capabilities?.pageSizes ?? pageSizes}
          disabled={page === undefined || isFetching}
          onOffsetChange={(offset) => {
            table.setPageIndex(Math.floor(offset / listState.limit));
          }}
          onLimitChange={(limit) => {
            table.setPageSize(limit);
          }}
        />
      </div>
    </GridDensityProvider>
  );
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
 */
const widthOf = (
  preferences: { readonly sizing: Readonly<Record<string, number>> },
  columnId: string,
): number | undefined =>
  Object.hasOwn(preferences.sizing, columnId)
    ? preferences.sizing[columnId]
    : undefined;

/** How far one arrow-key press moves an edge. */
const RESIZE_STEP = 16;

/**
 * The column's right edge, as a control (ADR-0041, `D4.5`).
 *
 * **A `button`, not a bare `div` with `onMouseDown`.** The ADR describes resize
 * as "a pointer drag on the header edge" and says nothing about the keyboard,
 * which would have made column widths the one grid affordance reachable by
 * mouse alone — in a panel whose every other control is operable by name and by
 * key. It costs an `aria-label` and two arrow keys, so it is a decision rather
 * than a gap: left and right nudge the edge, `Enter` and a double-click return
 * the column to content width.
 *
 * The drag listens on `window`, because a pointer that leaves the handle
 * mid-drag — which it does immediately, that being the point — must not end the
 * drag.
 */
const ResizeHandle = ({
  label,
  width,
  onResize,
  onReset,
}: {
  readonly label: string;
  /** The current width, or `undefined` while the column is content-sized. */
  readonly width: number | undefined;
  readonly onResize: (next: number) => void;
  readonly onReset: () => void;
}) => {
  /*
   * The drag listens on `window`, because a pointer that leaves the handle
   * mid-drag — which it does immediately, that being the point — must not end
   * the drag. That makes the listeners outlive the element unless something
   * says otherwise: `pointerup` normally cleans them up, but a navigation
   * mid-drag unmounts this button with the pointer still down, and ADR-0040
   * made record surfaces routes, so navigating away from a grid is ordinary.
   * One `AbortController` per drag, aborted on unmount, so the closure over the
   * table cannot be held by a grid that is gone.
   */
  const { t } = useT("grid");

  const drag = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      drag.current?.abort();
    },
    [],
  );

  return (
    <button
      type="button"
      aria-label={t("columns.resize", { column: label })}
      data-slot="grid-resize-handle"
      /*
       * **Visible at rest since `D10.2`** (ADR-0052 §Visible state). The band
       * itself stays transparent until hover or focus — a 6px stripe on every
       * column edge would be a second set of borders — and what is always
       * there is the `::after` grip: a 1×16px tick in `--grid-tick`, which is
       * the tick's own token since `D11.2` (ADR-0054 §4) rather than `--border`
       * — a rule and a grip want different weights, and dark especially wants
       * the grip *lighter* than the line it sits between. A token either way,
       * so both themes stay correct by construction.
       *
       * `h-4` centred rather than full height, which is what keeps it a
       * *handle* rather than a column divider: a full-height line would read
       * as table chrome and invite nobody to grab it.
       */
      className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize touch-none select-none bg-transparent after:absolute after:top-1/2 after:right-0.5 after:h-4 after:w-px after:-translate-y-1/2 after:bg-grid-tick after:transition-colors after:content-[''] hover:bg-border hover:after:bg-transparent focus-visible:bg-border focus-visible:after:bg-transparent focus-visible:outline-none"
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onReset();
          return;
        }

        const step =
          event.key === "ArrowLeft"
            ? -RESIZE_STEP
            : event.key === "ArrowRight"
              ? RESIZE_STEP
              : 0;

        if (step === 0) return;

        event.preventDefault();
        /*
         * The current width, or the rendered one for a column nobody has sized —
         * the same measurement the drag takes, for the same reason: the engine's
         * default is a number this grid never used.
         */
        onResize(
          (width ??
            event.currentTarget.parentElement?.getBoundingClientRect().width ??
            MIN_COLUMN_WIDTH) + step,
        );
      }}
      onPointerDown={(event) => {
        // Only the primary button, and never a text selection across the header.
        if (event.button !== 0) return;
        event.preventDefault();

        const cell = event.currentTarget.parentElement;
        const startX = event.clientX;
        const startWidth = width ?? cell?.getBoundingClientRect().width ?? 0;

        drag.current?.abort();
        const controller = new AbortController();

        drag.current = controller;

        const move = (moveEvent: PointerEvent) => {
          onResize(startWidth + moveEvent.clientX - startX);
        };
        const stop = () => {
          controller.abort();
        };

        const options = { signal: controller.signal };

        window.addEventListener("pointermove", move, options);
        window.addEventListener("pointerup", stop, options);
        window.addEventListener("pointercancel", stop, options);
      }}
    />
  );
};

/**
 * Placeholder rows, so the first load does not collapse the table to nothing.
 *
 * **They take the mode too** (`D11.6`, ADR-0054 §6). Left alone they carried
 * `TableCell`'s own `p-2` around a 16px skeleton — 32px against a 44px
 * Comfortable row — so every load shifted each row about twelve pixels when
 * the data landed. §6's table says the row height is the `td`'s, and a
 * placeholder that is not the height of the thing it stands in for is a
 * placeholder doing the opposite of its job.
 */
const LoadingRows = ({
  columns,
  density,
}: {
  readonly columns: number;
  readonly density: GridDensity;
}) => (
  <>
    {Array.from({ length: 5 }, (_, row) => (
      <TableRow key={row}>
        {Array.from({ length: columns }, (_, column) => (
          <TableCell
            key={column}
            className={cn(
              DENSITY_ROW_HEIGHT[density],
              DENSITY_CELL_X[density],
              "py-0",
            )}
          >
            <Skeleton className="h-4 w-full" />
          </TableCell>
        ))}
      </TableRow>
    ))}
  </>
);
