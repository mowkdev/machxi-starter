import type { Filter } from "@repo/contracts";
import { Trash2Icon } from "lucide-react";
import type { ReactNode } from "react";

import { useT } from "@repo/i18n";
import type { GridCapabilities, HotFilterConfig } from "@repo/resource";
import { Button } from "@repo/ui/components/button";
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
 * selection count. **Right:** the capability-driven actions, then ADR-0041's
 * columns menu.
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
   * A region with nothing in it is a band of dead space and a `gap-3` above the
   * table, on every grid whose endpoint is not searchable and whose resource
   * declares no capabilities and no hot filters — the same argument ADR-0039's
   * applied-filters bar makes for itself, and the one that got the filter row
   * deleted. It returns `null` rather than rendering an empty flex row.
   */
  if (
    !searchable &&
    hotFilters.length === 0 &&
    !showCreate &&
    !showBulkDelete &&
    selectedCount === 0 &&
    !isPresent(toolbarStart) &&
    !isPresent(toolbarEnd) &&
    !isPresent(columnsMenu)
  )
    return null;

  return (
    /*
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
     * band's edges. 8 + 32 + 8 is the tallest unwrapped row this band holds,
     * so the padding reaches the floor exactly rather than lifting it.
     */
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
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {showCreate ? createAction : null}

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

        {toolbarEnd}

        {/*
         * Last on the right, which is the seat ADR-0038 reserved for it when
         * the toolbar became a region: the actions that change *the data* come
         * first, and the control that changes *the view of it* sits at the end.
         */}
        {columnsMenu}
      </div>
    </div>
  );
};
