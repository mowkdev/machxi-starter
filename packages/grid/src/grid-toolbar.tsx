import type { Filter } from "@repo/contracts";
import { Trash2Icon } from "lucide-react";
import type { ReactNode } from "react";

import { useT } from "@repo/i18n";
import type { GridCapabilities, HotFilterConfig } from "@repo/resource";
import { Button } from "@repo/ui/components/button";
import {
  PageActionsPortal,
  usePageActionsContainer,
} from "@repo/ui/compositions/page-actions";
import { Separator } from "@repo/ui/components/separator";

import { GridSearch } from "./grid-search";
import { HotFilters } from "./hot-filter-controls";
import type { GridToolbarContext } from "./types";

/**
 * The grid's toolbar, as a named region (ADR-0038 §The toolbar becomes a real
 * region).
 *
 * D3 shipped "the toolbar carries `q` alone" and the implementation took it
 * literally: a bare conditional `div` with `GridSearch`, and the Create button
 * on the *page*, in a `CardHeader`'s `CardAction`, outside the grid entirely.
 * That was fine for one action. D4 brings several — ADR-0039's applied-filters
 * surface and ADR-0041's columns menu both need a home — and "each sibling
 * invents a div" is how a region grows without anyone deciding its shape.
 *
 * **Left:** search (`q` is the endpoint's property, not any column's), then
 * ADR-0039's hot-filter groups — which took that seat at `D4.4` — then the
 * selection block: the count, Clear selection and bulk Delete.
 *
 * **There is no right side any more** (`D11.12`, ADR-0054 §5). Create and
 * ADR-0041's columns menu were the two controls that sat there, and §5 seats
 * both in the page-header band beside `D11.6`'s density control; they reach
 * it through {@link PageActionsPortal}, keeping their state in this tree. The
 * group survives for `toolbarEnd` and for a grid rendered with no band above
 * it, which is the arrangement ADR-0038 wrote and the one package tests use.
 *
 * **Extension slots are JSX, not config** — the same line ADR-0035 drew for
 * form layout. A toolbar configured as *data* would either carry functions in
 * config or spawn a registry of toolbar actions whose entries are each used
 * once; capabilities say *whether*, JSX says *what else*.
 */

export interface GridToolbarProps extends GridToolbarContext {
  /** The narrowed capability block (ADR-0042 conjoins it above the grid). */
  readonly capabilities: GridCapabilities | undefined;
  readonly searchable: boolean;
  readonly searchValue: string;
  readonly onSearchCommit: (next: string) => void;
  /** The stances this resource declares (ADR-0039). None renders none. */
  readonly hotFilters: readonly HotFilterConfig[];
  /** The URL's validated filters — what the groups read their pressed state from. */
  readonly filters: readonly Filter[];
  /** One field's filters replaced whole, through the same `withFilters` channel. */
  readonly onHotFilterChange: (field: string, next: readonly Filter[]) => void;
  /**
   * The Create affordance, rendered only when `canCreate` (see the amendment
   * note on {@link AppGridProps.createAction}).
   */
  readonly createAction: ReactNode;
  readonly onBulkDelete:
    ((ids: readonly string[], context: GridToolbarContext) => void) | undefined;
  readonly toolbarStart: ReactNode;
  readonly toolbarEnd: ReactNode;
  /**
   * ADR-0041's Columns surface, or `null` where nothing is movable.
   *
   * `null` matters: {@link isPresent} asks whether a slot was *given*
   * something, and an element that renders nothing still counts as given — so
   * a component with an internal empty check would keep this region alive as a
   * band of dead space.
   */
  readonly columnsMenu: ReactNode;
}

/** Whether a slot was actually given something to render. */
const isPresent = (node: ReactNode): boolean =>
  node !== null && node !== undefined && node !== false;

export const GridToolbar = ({
  capabilities,
  searchable,
  searchValue,
  onSearchCommit,
  hotFilters,
  filters,
  onHotFilterChange,
  createAction,
  onBulkDelete,
  toolbarStart,
  toolbarEnd,
  columnsMenu,
  selectedIds,
  clearSelection,
}: GridToolbarProps) => {
  const { t } = useT("grid");
  const selectedCount = selectedIds.length;
  const showCreate =
    capabilities?.canCreate === true && isPresent(createAction);
  const showBulkDelete =
    capabilities?.canBulkDelete === true &&
    onBulkDelete !== undefined &&
    selectedCount > 0;

  /*
   * **Whether the page-header band is listening** (ADR-0054 §5, `D11.12`).
   *
   * §5 seats the Columns control and the primary action in that band beside
   * `D11.6`'s density control, which is the delta this step takes on
   * ADR-0038's "right side, capability-driven" toolbar and on ADR-0041's
   * "in the toolbar region 0038 reserves". Both parents stand for everything
   * else they decided — the capability block, selection and bulk-delete
   * semantics, the preference store, the popover, Reset — and lose only the
   * region these two controls are drawn in.
   *
   * `null` means no band, which is a real arrangement rather than a failure:
   * a grid rendered outside the shell has no page-header to reach and keeps
   * its controls where ADR-0038 put them. That is the only branch below.
   */
  const band = usePageActionsContainer() !== null;

  /*
   * Columns first, then the primary — §5's order, and the reverse of the
   * seat ADR-0038 gave the columns menu ("the control that changes the view
   * of it sits at the end"). That argument was about a row of *data* actions
   * it no longer shares a band with: in the page-header band the neighbours
   * are density and Columns, two view controls that read as a pair, and the
   * primary is the thing they are not.
   */
  const viewControls = (
    <>
      {columnsMenu}
      {showCreate ? createAction : null}
    </>
  );

  /*
   * A region with nothing in it is a band of dead space and a `gap-3` above the
   * table, on every grid whose endpoint is not searchable and whose resource
   * declares no capabilities and no hot filters — the same argument ADR-0039's
   * applied-filters bar makes for itself, and the one that got the filter row
   * deleted. It returns `null` rather than rendering an empty flex row.
   *
   * Since `D11.12` the two hoisted controls no longer count toward "nothing
   * in it" when a band is listening — they are not in this region to fill it
   * — but they still have to be rendered, so the empty case portals and draws
   * no band of its own.
   */
  if (
    !searchable &&
    hotFilters.length === 0 &&
    selectedCount === 0 &&
    !isPresent(toolbarStart) &&
    !isPresent(toolbarEnd) &&
    (band || (!showCreate && !isPresent(columnsMenu)))
  )
    return band ? <PageActionsPortal>{viewControls}</PageActionsPortal> : null;

  /*
   * The toolbar's own right-hand group, which on every shipped screen is now
   * empty and therefore absent: §5 draws this band with search and the
   * stances left-aligned and nothing after them. It survives for
   * `toolbarEnd`, ADR-0038's extension slot, and for the no-band fallback.
   */
  const showRight =
    (!band && (showCreate || isPresent(columnsMenu))) || isPresent(toolbarEnd);

  return (
    <>
      {band ? <PageActionsPortal>{viewControls}</PageActionsPortal> : null}

      {/*
       * `shrink-0`: the toolbar is static chrome in ADR-0037's height budget, and
       * a region that could shrink would take its space out of the scroll body
       * rather than declaring it. `flex-wrap` so a narrow viewport stacks the two
       * sides instead of overflowing the frame the D4.1 walk measured.
       *
       * **`px-4` since `D11.3`** (ADR-0054 §5): the page container went
       * full-bleed with the page card, so a band that did not carry its own
       * gutter would start at the inset's edge while the header above it starts
       * sixteen pixels in. The rows *should* run edge to edge — that is §4 —
       * and the chrome around them should not.
       *
       * **`min-h-12` since `D11.4`**: §5's 48px toolbar band, declared as a
       * floor rather than as a height because `flex-wrap` above is load-bearing
       * — a narrow viewport stacks the two sides instead of overflowing the
       * frame the `D4.1` walk measured, and a fixed `h-12` would let the second
       * row spill out of the band rather than growing it. Unwrapped, which is
       * every viewport the design is drawn at, the band is 48.
       *
       * The `py-2` is what makes that floor honest in the wrapped case: a floor
       * alone pads nothing, so two rows of controls would sit flush against the
       * band's edges. 8 + 32 + 8 is the tallest unwrapped row this band
       * holds **once the view controls are hoisted**, which is every shipped
       * screen, so the padding reaches the floor exactly rather than lifting
       * it. In the no-band fallback the 34px pair sits here instead and the
       * band measures 50 — that arrangement's number, not §5's, because §5
       * describes the band these controls have left.
       */}
      <div
        data-slot="grid-toolbar"
        className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 px-4 py-2"
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {searchable ? (
            <GridSearch value={searchValue} onCommit={onSearchCommit} />
          ) : null}

          {/*
           * Between search and the bespoke slot, which is the order ADR-0039
           * names: the declarable stances first, then whatever a screen composed
           * by hand. Nothing renders when a resource declares none.
           */}
          <HotFilters
            hotFilters={hotFilters}
            filters={filters}
            onChange={onHotFilterChange}
          />

          {toolbarStart}

          {selectedCount > 0 ? (
            <div className="flex items-center gap-2">
              <Separator orientation="vertical" className="h-5" />
              {/*
               * "N selected", never "N of this page" — the count renders what is
               * true. Selection is keyed by resource id and survives paging, so
               * part of this number may be rows the operator cannot currently
               * see, and a "Clear selection" beside it is what makes that state
               * escapable without hunting for the rows.
               */}
              <span
                aria-live="polite"
                /*
                 * `text-xs` since `D11.4`: §3's 12/16 meta rung. Not the 13 the
                 * cells and the pager's range read at — that rung is controls and
                 * data, and "3 selected" is neither.
                 */
                className="text-xs text-muted-foreground tabular-nums"
              >
                {t("selection.count", { count: selectedCount })}
              </span>
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                {t("selection.clear")}
              </Button>

              {/*
               * Bulk delete joined the selection block at `D11.12`, from the
               * toolbar's right-hand group. It is a *selection* action — it
               * exists only while the count beside it is non-zero and acts on
               * exactly those ids — so it belongs with the count and the escape
               * from it rather than with the controls that were hoisted to the
               * band. ADR-0038's semantics are untouched: same capability, same
               * handler, same ids.
               */}
              {showBulkDelete ? (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    onBulkDelete(selectedIds, { selectedIds, clearSelection });
                  }}
                >
                  <Trash2Icon aria-hidden />
                  {t("selection.delete", { count: selectedCount })}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {showRight ? (
          <div className="flex flex-wrap items-center gap-2">
            {band ? null : viewControls}
            {toolbarEnd}
          </div>
        ) : null}
      </div>
    </>
  );
};
