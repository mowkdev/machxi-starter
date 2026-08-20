import { MAX_LIMIT } from "@repo/contracts";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
} from "lucide-react";

import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui";

/**
 * A real pager, because the total is real (ADR-0035).
 *
 * ADR-0012 guarantees `meta.pagination` on every list response and every v1
 * endpoint returns a genuine filtered count, so this can say "21–40 of 143" and
 * offer a jump to the last page — rather than the "page 1 of 1" a grid that
 * only knows the rows it holds is reduced to.
 *
 * Buttons and not the `Pagination` primitives from `@repo/ui`: those render
 * anchors, and these controls are neither links nor navigable targets from the
 * grid's own point of view — it reports a state change and its owner decides
 * whether that is a navigation. An `<a>` with no `href` is also a control no
 * keyboard reaches, which ADR-0036's role-and-label discipline would catch on
 * the way in.
 */

/** The sizes offered when the caller does not say otherwise. */
const DEFAULT_PAGE_SIZES: readonly number[] = [10, 20, 50, 100];

/**
 * What the select actually offers: the caller's sizes (or the defaults),
 * bounded by the contract's hard ceiling, deduplicated, ascending — plus the
 * current `limit` itself. Deriving the bound from `MAX_LIMIT` rather than
 * restating it means a change to the contract cannot leave the select offering
 * a size the API rejects; including `limit` is for the URL being user-writable
 * (ADR-0034) — `?limit=37` is a state this control must be able to display,
 * and a select whose value is not among its options silently shows nothing.
 */
export const offeredSizes = (
  sizes: readonly number[],
  limit: number,
): readonly number[] =>
  [
    ...new Set(
      [...sizes, limit].filter(
        (size) => Number.isInteger(size) && size >= 1 && size <= MAX_LIMIT,
      ),
    ),
  ].sort((a, b) => a - b);

export interface GridPagerProps {
  readonly offset: number;
  readonly limit: number;
  /** `null` where the endpoint opted out of `count(*)` (ADR-0014). */
  readonly total: number | null;
  /** Rows on the page in hand — the only clue to "is there more" when total is null. */
  readonly rowCount: number;
  /**
   * Offset of the last page that holds a row, or `null` when the endpoint did
   * not count and there is therefore no last page to jump to.
   *
   * Passed in rather than derived here: the engine already computes it from the
   * `rowCount` the envelope supplied, and a pager that recomputed it would be a
   * second answer to a question that has one.
   */
  readonly lastOffset: number | null;
  readonly onOffsetChange: (offset: number) => void;
  readonly onLimitChange: (limit: number) => void;
  /** Page-size options; the current `limit` is always offered alongside. */
  readonly pageSizes?: readonly number[] | undefined;
  readonly disabled?: boolean;
}

export const GridPager = ({
  offset,
  limit,
  total,
  rowCount,
  lastOffset,
  onOffsetChange,
  onLimitChange,
  pageSizes = DEFAULT_PAGE_SIZES,
  disabled = false,
}: GridPagerProps) => {
  const sizes = offeredSizes(pageSizes, limit);
  const first = rowCount === 0 ? 0 : offset + 1;
  const last = offset + rowCount;

  /*
   * `total: null` is the open-ended branch. The type reserves it for endpoints
   * that opt out of counting, and none do today — but a pager that assumes a
   * number renders `NaN` the day one does, so the branch is written now rather
   * than discovered then. Without a total there is no last page to jump to and
   * no "of N" to show; a full page is the only evidence that more exists.
   */
  const isOpenEnded = total === null || lastOffset === null;
  const canGoBack = offset > 0;
  const canGoForward = isOpenEnded ? rowCount === limit : offset < lastOffset;

  const range =
    rowCount === 0
      ? "No results"
      : isOpenEnded
        ? `${String(first)}–${String(last)}`
        : `${String(first)}–${String(last)} of ${String(total)}`;

  return (
    <nav
      aria-label="Pagination"
      /*
       * `shrink-0` because this is the budget's static footer (ADR-0037): it
       * declares its height and the scroll body takes the rest, so a page of
       * twenty rows no longer hides the pager below the fold.
       */
      className="flex shrink-0 flex-wrap items-center justify-between gap-4 px-2 py-3"
    >
      <p className="text-sm text-muted-foreground" data-slot="grid-range">
        {range}
      </p>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Label htmlFor="grid-page-size" className="text-sm font-normal">
            Rows per page
          </Label>
          <Select
            value={String(limit)}
            disabled={disabled}
            onValueChange={(next) => {
              onLimitChange(Number(next));
            }}
          >
            <SelectTrigger id="grid-page-size" size="sm" className="w-[4.5rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sizes.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="First page"
            disabled={disabled || !canGoBack}
            onClick={() => {
              onOffsetChange(0);
            }}
          >
            <ChevronsLeftIcon aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous page"
            disabled={disabled || !canGoBack}
            onClick={() => {
              onOffsetChange(Math.max(0, offset - limit));
            }}
          >
            <ChevronLeftIcon aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next page"
            disabled={disabled || !canGoForward}
            onClick={() => {
              onOffsetChange(offset + limit);
            }}
          >
            <ChevronRightIcon aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Last page"
            // Open-ended means there is no last page to reach, so the control
            // says so instead of guessing one.
            disabled={disabled || isOpenEnded || offset >= lastOffset}
            onClick={() => {
              // Unreachable while `isOpenEnded`, which is what disables it.
              if (lastOffset !== null) onOffsetChange(lastOffset);
            }}
          >
            <ChevronsRightIcon aria-hidden />
          </Button>
        </div>
      </div>
    </nav>
  );
};
