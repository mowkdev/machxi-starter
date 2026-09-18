import {
  DEFAULT_GRID_DENSITY,
  type GridDensity,
  type ListQuerySearch,
  type Page,
} from "@repo/contracts";
import type { ReactNode } from "react";

import type { TranslationKey } from "@repo/i18n";
import type {
  ColumnConfigMap,
  ColumnOverrides,
  GridCapabilities,
  HotFilterConfig,
  UnknownShape,
} from "@repo/resource";
import { Table } from "@repo/ui/components/table";

import { AppliedFilters } from "./applied-filters";
import { GridBody } from "./app-grid/body";
import { GridHeader } from "./app-grid/header";
import { useAppGridState } from "./app-grid/state";
import { ColumnsMenu } from "./columns-menu";
import { GridDensityProvider } from "./density";
import { GridPager } from "./grid-pager";
import { GridToolbar } from "./grid-toolbar";
import { clearedFilters, withSearch, withoutFilter } from "./list-state";
import type { PreferenceStorage } from "./preferences";
import type { GridMeta, GridToolbarContext } from "./types";

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
 *
 * **Three files since `D20.7`, and this one composes them.** The wiring is
 * `./app-grid/state.ts`, the header rows are `./app-grid/header.tsx` and the
 * body rows are `./app-grid/body.tsx`; what is left here is the props contract,
 * the region stack and the chrome between the regions. The cut is a move and
 * not a redesign: the hook is called once and unconditionally so React sees the
 * same sequence of hooks it always did, and neither region introduced a wrapper
 * element, because ADR-0037's height budget is a claim about exactly the
 * elements between the scroll container and the table.
 */

/*
 * Every optional prop admits an explicit `undefined`, because the repository
 * runs `exactOptionalPropertyTypes` and the natural call site is
 * `page={query.data}` — a value that is legitimately `undefined` while the
 * first page loads. Without the annotation every consumer would have to spread
 * conditionally, which is ceremony in the layer this machinery exists to keep
 * thin.
 */
export interface AppGridProps<TRow = UnknownShape> {
  /**
   * The resource's columns (ADR-0035), keyed by the row (ADR-0063 §1).
   *
   * `TRow` is inferred from `page` and travels here since `D14.10`: a column
   * this grid could only ever render empty is a compile error at the call site
   * rather than a blank cell in front of an operator. The machinery below keeps
   * reading rows as {@link GridRow}, because it genuinely does not know the
   * resource — the type travels at the door, which is the rule the `shared/`
   * slices already follow.
   *
   * **`NoInfer`, and it matters**: the row is what the *data* says it is, and
   * these are checked against it. Without it a config and a page that disagreed
   * would infer a union and typecheck, which is precisely the disagreement this
   * exists to catch. A usage with no `page` at all — a harness rendering the
   * loading state — falls back to the parameter's default, where the map is
   * string-keyed exactly as it was before this step.
   */
  readonly columns: ColumnConfigMap<NoInfer<TRow>>;
  /** Per-usage adjustments — headers, hidden columns — merged over the above. */
  readonly overrides?: ColumnOverrides<NoInfer<TRow>> | undefined;
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

/** One frozen empty array, so the default does not re-identify per render. */
const NO_HOT_FILTERS: readonly HotFilterConfig[] = Object.freeze([]);

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

export const AppGrid = <TRow = UnknownShape,>({
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
  /*
   * One call, unconditional and first: every hook the component used to spell
   * out is inside, in the order it was called in, which is what makes `D20.7`'s
   * split a move rather than a rewrite.
   */
  const {
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
  } = useAppGridState<TRow>({
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
  });

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
     * no call site here to hand a badge its height. The two `cn` calls in the
     * header and body read `density` directly; only the registry's components
     * need the context.
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
            <GridHeader
              headerGroups={headerGroups}
              table={table}
              preferences={preferences}
              density={density}
              setColumnWidth={setColumnWidth}
              clearColumnWidth={clearColumnWidth}
            />

            <GridBody
              page={page}
              error={error}
              onRetry={onRetry}
              renderError={renderError}
              bodyRows={bodyRows}
              columnCount={columnCount}
              table={table}
              preferences={preferences}
              density={density}
              striped={striped}
              emptyMessage={emptyMessage}
              t={t}
              tk={tk}
            />
          </Table>
        </div>

        {/*
         * The pager reports through the engine rather than around it, so
         * `onPaginationChange` in `state.ts` is the single path a page change
         * takes — the same loop a header click takes through `onSortingChange`.
         * Its last page is `getPageCount()`, which is derived from the
         * `rowCount` the envelope's `meta.pagination.total` supplied; `null`
         * says the endpoint did not count and there is no last page to offer.
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
