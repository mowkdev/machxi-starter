import type { GridDensity } from "@repo/contracts";
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { useT } from "@repo/i18n";
import { Button } from "@repo/ui/components/button";
import { TableHead, TableHeader, TableRow } from "@repo/ui/components/table";
import { cn } from "@repo/ui/lib/utils";

import type { ColumnFilterValue } from "../column-filters";
import { DENSITY_CELL_X } from "../density";
import { ColumnFilterDialog } from "../filter-dialog";
import { MIN_COLUMN_WIDTH, type GridPreferences } from "../preferences";
import { widthOf, type AppGridTable, type GridHeaderGroups } from "./state";

/**
 * The grid's header rows (`D20.7`).
 *
 * A component rather than an inline region, and it renders **exactly** the
 * `<TableHeader>` subtree `app-grid.tsx` used to spell inline — no wrapper
 * element was added to hold it, because ADR-0037's height budget is a claim
 * about the elements between the scroll container and the table, and an extra
 * `div` here would be a claim of a different shape. A React component
 * boundary is free in the DOM, which is what makes this cut available at all.
 */

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

export interface GridHeaderProps {
  readonly headerGroups: GridHeaderGroups;
  readonly table: AppGridTable;
  readonly preferences: GridPreferences;
  readonly density: GridDensity;
  readonly setColumnWidth: (columnId: string, width: number) => void;
  readonly clearColumnWidth: (columnId: string) => void;
}

export const GridHeader = ({
  headerGroups,
  table,
  preferences,
  density,
  setColumnWidth,
  clearColumnWidth,
}: GridHeaderProps) => (
  /*
   * Sticky within the scroll body — the point of the budget. It carries
   * an opaque background so rows pass *under* the header rather than
   * through it, and a stacking order, because ADR-0039's filter
   * popovers and ADR-0038's row menus will float in this same
   * container and have to layer against it knowingly. The opaque
   * background is on the cells rather than on the `thead`, for the
   * reason `STICKY_HEADER_TABLE` in `app-grid.tsx` records — and since `D11.2`
   * that background is `--grid-header`, the header band's own ground rather
   * than the card's (ADR-0054 §4).
   */
  <TableHeader className="sticky top-0 z-10 [&_td]:bg-grid-header [&_th]:bg-grid-header">
    {headerGroups.map((headerGroup) => (
      <TableRow key={headerGroup.id}>
        {headerGroup.headers.map((header) => {
          const sorted = header.column.getIsSorted();
          const align = header.column.columnDef.meta?.align ?? "start";
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
                  width === undefined ? undefined : { width, maxWidth: width }
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
                      <ChevronsUpDownIcon aria-hidden className="opacity-50" />
                    )}
                  </Button>
                ) : (
                  <table.FlexRender header={header} />
                )}

                {filter === undefined ? null : (
                  <ColumnFilterDialog
                    field={header.column.id}
                    label={String(
                      header.column.columnDef.header ?? header.column.id,
                    )}
                    config={filter}
                    /*
                     * Committed through the engine, not around it: the
                     * dialog's Apply is `setFilterValue`, which lands in
                     * `onColumnFiltersChange` in `state.ts` and navigates. One
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

              {header.column.columnDef.meta?.structural === true ? null : (
                <ResizeHandle
                  label={String(
                    header.column.columnDef.header ?? header.column.id,
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
);

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
