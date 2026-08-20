import type { ListQuerySearch, Page } from "@repo/contracts";
import {
  useTable,
  type ColumnFiltersState,
  type OnChangeFn,
  type PaginationState,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";
import { useEffect, useMemo } from "react";

import { mergeColumns } from "@/shared/resource/config";
import type { ColumnConfigMap, ColumnOverrides } from "@/shared/resource/types";
import {
  Button,
  QueryError,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@/shared/ui";

import {
  filterableColumns,
  fromColumnFiltersState,
  toColumnFiltersState,
  type ColumnFilterValue,
} from "./column-filters";
import { buildColumns, type GridRow } from "./columns";
import { gridFeatures } from "./features";
import { FilterControl, GridSearch } from "./filter-controls";
import { GridPager } from "./grid-pager";
import {
  fromSortingState,
  isStranded,
  lastPageOffset,
  toSortingState,
  withFilters,
  withLimit,
  withOffset,
  withSearch,
  withSort,
} from "./list-state";
import type { GridMeta } from "./types";

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
  /** The validated search params the route owns (ADR-0034). */
  readonly listState: ListQuerySearch;
  readonly onListStateChange: (next: ListQuerySearch) => void;
  /** Handlers the registry's cell renderers reach through `table.options.meta`. */
  readonly meta?: GridMeta<TRow> | undefined;
  /** Stable row identity. Defaults to an `id` field, which every resource has. */
  readonly getRowId?: ((row: TRow) => string) | undefined;
  /** Whether the endpoint implements ADR-0014's `q` search. */
  readonly searchable?: boolean | undefined;
  readonly isFetching?: boolean | undefined;
  /** Shown in place of rows when the page is empty. */
  readonly emptyMessage?: string | undefined;
  /** Page-size options for the pager; the pager's own defaults when absent. */
  readonly pageSizes?: readonly number[] | undefined;
}

const NO_ROWS: readonly never[] = [];

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
  "[&_thead_th]:border-b [&_thead_td]:border-b",
  "[&_tbody_td]:border-b [&_tbody_tr:last-child>td]:border-b-0",
].join(" ");

export const AppGrid = <TRow,>({
  columns,
  overrides,
  page,
  error,
  onRetry,
  listState,
  onListStateChange,
  meta,
  getRowId,
  searchable = false,
  isFetching = false,
  emptyMessage = "No results.",
  pageSizes,
}: AppGridProps<TRow>) => {
  const merged = useMemo(
    () => mergeColumns(columns, overrides),
    [columns, overrides],
  );
  const filterable = useMemo(() => filterableColumns(merged), [merged]);

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
  const tableColumns = useMemo(
    () => buildColumns(columns, overrides),
    [columns, overrides],
  );

  const rows = (page?.items ?? NO_ROWS) as readonly GridRow[];

  const sorting = useMemo(
    () => toSortingState(listState.sort),
    [listState.sort],
  );
  const columnFilters = useMemo(
    () => toColumnFiltersState(listState.filters, filterable),
    [listState.filters, filterable],
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
    state: { sorting, columnFilters, pagination },
    onSortingChange,
    onColumnFiltersChange,
    onPaginationChange,
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

  const headerGroups = table.getHeaderGroups();
  const bodyRows = table.getRowModel().rows;
  const columnCount = merged.length;

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
     */
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      {searchable ? (
        <div className="flex shrink-0 items-center gap-2">
          <GridSearch
            value={listState.q ?? ""}
            onCommit={(term) => {
              onListStateChange(withSearch(listState, term));
            }}
          />
        </div>
      ) : null}

      {/*
       * The one scroll container (ADR-0037), on both axes, and the floor that
       * keeps a short viewport honest: when `min-h-64` wins, the column grows
       * past the viewport and the document scrolls — D3's behaviour, reached by
       * degrading rather than by crushing the grid to two rows.
       *
       * `bg-card` is here as well as on the sticky header so the two agree
       * whatever this grid is mounted in; in dark mode `card` and `background`
       * are different tokens, and a header that borrowed the wrong one would
       * show it the moment a row passed under it.
       */}
      <div
        data-slot="grid-scroll"
        className="scrollbar-thin min-h-64 w-full min-w-0 flex-1 overflow-auto rounded-md border bg-card"
      >
        <Table container={false} className={STICKY_HEADER_TABLE}>
          {/*
           * Sticky within the scroll body — the point of the budget. It carries
           * an opaque background so rows pass *under* the header rather than
           * through it, and a stacking order, because ADR-0039's filter
           * popovers and ADR-0038's row menus will float in this same
           * container and have to layer against it knowingly. The opaque
           * background is on the cells rather than on the `thead`, for the
           * reason `STICKY_HEADER_TABLE` above records.
           */}
          <TableHeader className="sticky top-0 z-10 [&_td]:bg-card [&_th]:bg-card">
            {headerGroups.map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  const align = header.column.columnDef.meta?.align ?? "start";

                  return (
                    <TableHead
                      key={header.id}
                      className={cn(align === "end" && "text-right")}
                      aria-sort={
                        sorted === false
                          ? undefined
                          : sorted === "asc"
                            ? "ascending"
                            : "descending"
                      }
                    >
                      {header.column.getCanSort() ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="-ml-2 h-8 data-[state=open]:bg-accent"
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
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}

            {/*
             * The filter row exists only if something can be filtered. An empty
             * second header row would be a band of dead space on every grid
             * whose contract allow-lists nothing.
             *
             * Its cells are `td`, not `th`, even though they sit in the
             * `thead`: a `th` claims the `columnheader` role, and these cells
             * label nothing — they hold controls. Marking them up as headers
             * would tell a screen reader that this table has twelve column
             * headers for six columns, and would put a second "header" row in
             * front of every row query a test writes.
             */}
            {filterable.length > 0 ? (
              <TableRow data-slot="grid-filters">
                {headerGroups[0]?.headers.map((header) => {
                  const config = header.column.columnDef.meta?.filter;

                  return (
                    <TableCell key={header.id} className="p-2">
                      {config === undefined ? null : (
                        <FilterControl
                          field={header.column.id}
                          label={String(
                            header.column.columnDef.header ?? header.column.id,
                          )}
                          config={config}
                          value={
                            header.column.getFilterValue() as
                              ColumnFilterValue | undefined
                          }
                          onChange={(next) => {
                            header.column.setFilterValue(next);
                          }}
                        />
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ) : null}
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
                  <QueryError error={error} onRetry={onRetry} />
                </TableCell>
              </TableRow>
            ) : page === undefined ? (
              <LoadingRows columns={columnCount} />
            ) : bodyRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columnCount}
                  className="h-24 text-center text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              bodyRows.map((row) => (
                <TableRow key={row.id}>
                  {row.getAllCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        cell.column.columnDef.meta?.align === "end" &&
                          "text-right",
                      )}
                    >
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
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
        pageSizes={pageSizes}
        disabled={page === undefined || isFetching}
        onOffsetChange={(offset) => {
          table.setPageIndex(Math.floor(offset / listState.limit));
        }}
        onLimitChange={(limit) => {
          table.setPageSize(limit);
        }}
      />
    </div>
  );
};

/** Placeholder rows, so the first load does not collapse the table to nothing. */
const LoadingRows = ({ columns }: { readonly columns: number }) => (
  <>
    {Array.from({ length: 5 }, (_, row) => (
      <TableRow key={row}>
        {Array.from({ length: columns }, (_, column) => (
          <TableCell key={column}>
            <Skeleton className="h-4 w-full" />
          </TableCell>
        ))}
      </TableRow>
    ))}
  </>
);
