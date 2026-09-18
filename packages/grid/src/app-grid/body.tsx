import type { GridDensity, Page } from "@repo/contracts";
import type { ReactNode } from "react";

import type { TranslationKey } from "@repo/i18n";
import { Skeleton } from "@repo/ui/components/skeleton";
import { TableBody, TableCell, TableRow } from "@repo/ui/components/table";
import { cn } from "@repo/ui/lib/utils";

import { DENSITY_CELL_X, DENSITY_ROW_HEIGHT } from "../density";
import type { GridPreferences } from "../preferences";
import {
  widthOf,
  type AppGridTable,
  type GridBodyRows,
  type GridTranslate,
} from "./state";

/**
 * The grid's body rows and the three states that stand in for them (`D20.7`).
 *
 * A component rather than an inline region, and like the header it renders
 * **exactly** the `<TableBody>` subtree `app-grid.tsx` used to spell inline:
 * no wrapper element holds it, because ADR-0037's height budget is a claim
 * about the elements on the path from the scroll container down to the grid
 * and a `div` added to make a cut convenient would be a claim of a different
 * shape.
 *
 * The four branches are one `if` chain for a reason worth keeping in view: a
 * failure wins over loading, an empty page is not a failure, and every one of
 * them is a `<TableRow>` — which is why the stripe below is a CSS selector
 * rather than a computed index.
 */

export interface GridBodyProps<TRow> {
  /** The page in hand. `undefined` while the first one is loading. */
  readonly page: Page<TRow> | undefined;
  readonly error: unknown;
  readonly onRetry: (() => void) | undefined;
  readonly renderError: (props: {
    readonly error: unknown;
    readonly onRetry?: (() => void) | undefined;
  }) => ReactNode;
  readonly bodyRows: GridBodyRows;
  readonly columnCount: number;
  readonly table: AppGridTable;
  readonly preferences: GridPreferences;
  readonly density: GridDensity;
  readonly striped: boolean;
  readonly emptyMessage: TranslationKey | undefined;
  /** This package's own copy, for the fallback empty sentence. */
  readonly t: GridTranslate;
  /** The resource's copy, for the empty sentence a screen wrote (`D7.4`). */
  readonly tk: (key: TranslationKey) => string;
}

export const GridBody = <TRow,>({
  page,
  error,
  onRetry,
  renderError,
  bodyRows,
  columnCount,
  table,
  preferences,
  density,
  striped,
  emptyMessage,
  t,
  tk,
}: GridBodyProps<TRow>) => (
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
         * (see `STICKY_HEADER_TABLE` in `app-grid.tsx`) and a row-level
         * shadow in the separated model is the same promise a row-level
         * *border* turned out not to keep at `D4.1`. A cell keeps it.
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
                  cell.column.columnDef.meta?.mono === true && "font-mono",
                  cell.column.columnDef.meta?.align === "end" && "text-right",
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
);

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
