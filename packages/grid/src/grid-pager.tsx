import { MAX_LIMIT } from "@repo/contracts";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
} from "lucide-react";

import { useT } from "@repo/i18n";
import { Button } from "@repo/ui/components/button";
import { Label } from "@repo/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";

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
  const { t } = useT("grid");
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

  /*
   * The three numbers are interpolated as **strings**, deliberately.
   *
   * i18next's built-in `number` formatter would localise a group separator into
   * them, and this is a row range rather than a quantity: `1–20 of 1,432`
   * reading `1–20 no 1 432` in another locale is fine, but `1,000–1,020` in
   * *this* one would put a comma inside a range that already uses an en dash as
   * its separator. The count on a pager is an address, not an amount.
   */
  const range =
    rowCount === 0
      ? t("pager.none")
      : isOpenEnded
        ? t("pager.rangeOpen", { first: String(first), last: String(last) })
        : t("pager.range", {
            first: String(first),
            last: String(last),
            total: String(total),
          });

  return (
    <nav
      aria-label={t("pager.label")}
      /*
       * `shrink-0` because this is the budget's static footer (ADR-0037): it
       * declares its height and the scroll body takes the rest, so a page of
       * twenty rows no longer hides the pager below the fold.
       *
       * `px-2` became `px-4` at `D11.3` for the reason the toolbar gained
       * one: the page card is gone and the container is full-bleed, so each
       * band carries the inset's gutter itself (ADR-0054 §5).
       */
      className="flex shrink-0 flex-wrap items-center justify-between gap-4 px-4 py-3"
    >
      {/*
       * The range takes the mono face (ADR-0054 §4, `D11.2`): it is a count,
       * not a sentence, and the digits stopped shifting under it the moment
       * the page changed. `text-[13px]` is §3's data size, the same one the
       * cells above it read at.
       */}
      <p
        className="font-mono text-[13px] text-muted-foreground"
        data-slot="grid-range"
      >
        {range}
      </p>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Label htmlFor="grid-page-size" className="text-sm font-normal">
            {t("pager.rowsPerPage")}
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
            aria-label={t("pager.first")}
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
            aria-label={t("pager.previous")}
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
            aria-label={t("pager.next")}
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
            aria-label={t("pager.last")}
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
