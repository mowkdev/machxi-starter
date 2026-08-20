import { Trash2Icon } from "lucide-react";
import type { ReactNode } from "react";

import type { GridCapabilities } from "@/shared/resource/types";
import { Button, Separator } from "@/shared/ui";

import { GridSearch } from "./filter-controls";
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
 * **Left:** search (`q` is the endpoint's property, not any column's), then the
 * seat ADR-0039's hot-filter groups take, then the selection count. **Right:**
 * the capability-driven actions, then ADR-0041's columns menu.
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
  /**
   * The Create affordance, rendered only when `canCreate` (see the amendment
   * note on {@link AppGridProps.createAction}).
   */
  readonly createAction: ReactNode;
  readonly onBulkDelete:
    ((ids: readonly string[], context: GridToolbarContext) => void) | undefined;
  readonly toolbarStart: ReactNode;
  readonly toolbarEnd: ReactNode;
}

/** Whether a slot was actually given something to render. */
const isPresent = (node: ReactNode): boolean =>
  node !== null && node !== undefined && node !== false;

export const GridToolbar = ({
  capabilities,
  searchable,
  searchValue,
  onSearchCommit,
  createAction,
  onBulkDelete,
  toolbarStart,
  toolbarEnd,
  selectedIds,
  clearSelection,
}: GridToolbarProps) => {
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
   * declares no capabilities — the same argument the filter row already makes
   * for itself. It returns `null` rather than rendering an empty flex row.
   */
  if (
    !searchable &&
    !showCreate &&
    !showBulkDelete &&
    selectedCount === 0 &&
    !isPresent(toolbarStart) &&
    !isPresent(toolbarEnd)
  )
    return null;

  return (
    /*
     * `shrink-0`: the toolbar is static chrome in ADR-0037's height budget, and
     * a region that could shrink would take its space out of the scroll body
     * rather than declaring it. `flex-wrap` so a narrow viewport stacks the two
     * sides instead of overflowing the frame the D4.1 walk measured.
     */
    <div
      data-slot="grid-toolbar"
      className="flex shrink-0 flex-wrap items-center gap-2"
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {searchable ? (
          <GridSearch value={searchValue} onCommit={onSearchCommit} />
        ) : null}

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
              className="text-sm text-muted-foreground tabular-nums"
            >
              {selectedCount} selected
            </span>
            <Button variant="ghost" size="sm" onClick={clearSelection}>
              Clear selection
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
            Delete {selectedCount}
          </Button>
        ) : null}

        {toolbarEnd}
      </div>
    </div>
  );
};
