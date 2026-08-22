import type { Filter } from "@repo/contracts";
import { XIcon } from "lucide-react";

import { useKeyT, useT } from "@/shared/i18n";
import type { ColumnConfig, HotFilterConfig } from "@/shared/resource/types";
import { Badge, Button } from "@/shared/ui";

import { chipsForState } from "./filter-chips";
import { displayedByHotFilters } from "./hot-filters";

/**
 * The applied-filters bar (ADR-0039, `D4.4`).
 *
 * A static region between ADR-0038's toolbar and the table, in ADR-0037's
 * height budget: one removable chip per applied filter, a chip for an active
 * `q`, and Clear all. Nothing at all when nothing is applied — a permanent
 * empty band above every unfiltered grid is the thing the filter row was
 * deleted for.
 *
 * It answers the second of the three complaints ADR-0039 opens with. An
 * operator on a filtered, searched, page-3 view used to have to read five
 * controls to answer "what am I looking at?", and a filter carried by a deep
 * link on a field with no visible control was answered by *nothing on screen at
 * all* — the grid showed fewer rows than expected and no UI admitted why.
 *
 * **What makes it honest is where it reads from**: `chipsForState` walks the
 * URL's validated filters, and the column configs contribute labels only, never
 * membership. See that function for the argument.
 */

export interface AppliedFiltersProps {
  /** The URL's validated filters — every one gets a chip or a pressed button. */
  readonly filters: readonly Filter[];
  /** ADR-0014's `q`. Empty means no search chip. */
  readonly q: string;
  /** Labels for the filters a column owns. Never membership. */
  readonly columns: readonly (readonly [string, ColumnConfig])[];
  /** What the toolbar is already displaying, so it is not displayed twice. */
  readonly hotFilters: readonly HotFilterConfig[];
  readonly onRemoveFilter: (filter: Filter) => void;
  readonly onRemoveSearch: () => void;
  readonly onClearAll: () => void;
}

export const AppliedFilters = ({
  filters,
  q,
  columns,
  hotFilters,
  onRemoveFilter,
  onRemoveSearch,
  onClearAll,
}: AppliedFiltersProps) => {
  /*
   * Three translators, and the split is a type decision rather than a style
   * one. The first two are this component's own copy, one namespace each, so a
   * key either resolves is checked as that namespace's. The third is the
   * **app-wide** one `D7.4` gave `chipsForState`: a chip's words are partly the
   * column's — its header, a `presence` label, an enum option — and those are
   * keys from a namespace `shared/grid` must never name (ADR-0032).
   */
  const { t } = useT("grid");
  const { t: tCommon } = useT("common");
  const tk = useKeyT();

  /*
   * Suppressed, not omitted: the chip is skipped exactly while a hot-filter
   * button *displays* the same entry, because the pressed button already is its
   * visible, removable representation and two removal affordances for one
   * filter is noise. The invariant is unchanged — every applied filter is
   * visible and removable in exactly one place — and a value no group can
   * represent gets its chip as before.
   */
  const displayed = displayedByHotFilters(filters, hotFilters);
  const chips = chipsForState(filters, columns, tk).filter(
    (chip) => !displayed.has(chip.filter),
  );

  const applied = filters.length + (q === "" ? 0 : 1);

  return (
    <>
      {/*
       * One polite announcement per change, with wording chosen rather than
       * whatever the DOM diff happened to be: an `aria-live` on the chip list
       * itself would read every added and removed chip aloud in sequence.
       *
       * **Outside the conditional, and mounted even at zero.** A live region is
       * announced when its *contents* change, so one that mounts already
       * populated is read unreliably and one that unmounts is not read at all —
       * which would have made clearing the last filter, the change most worth
       * hearing, the single change this bar stayed silent about. Keeping it a
       * sibling rather than a child of the row is what lets the row itself
       * disappear: `sr-only` is `position: absolute`, so this span is out of
       * flow, is not a flex item of ADR-0037's column, and costs no `gap`.
       */}
      <span role="status" aria-live="polite" className="sr-only">
        {applied === 0 ? "" : t("applied.announce", { count: applied })}
      </span>

      {/*
       * The row renders whenever anything is *applied*, which is not the same
       * as "there are chips". A pressed hot filter has no chip by the
       * suppression rule above, and it still has to be clearable from here —
       * Clear all clears hot filters too, because they are filters and not a
       * separate mechanism.
       */}
      {applied === 0 ? null : (
        <div
          data-slot="grid-applied-filters"
          className="flex shrink-0 flex-wrap items-center gap-2"
        >
          {q === "" ? null : (
            <Chip
              label={t("applied.search", { term: q })}
              onRemove={onRemoveSearch}
            />
          )}

          {chips.map((chip) => (
            <Chip
              key={chip.key}
              label={chip.label}
              onRemove={() => {
                onRemoveFilter(chip.filter);
              }}
            />
          ))}

          <Button
            variant="ghost"
            size="sm"
            className="h-7"
            onClick={onClearAll}
          >
            {tCommon("actions.clearAll")}
          </Button>
        </div>
      )}
    </>
  );
};

/**
 * One filter, said in words, with the button that undoes it.
 *
 * The remove control names the whole chip rather than saying "Remove": a row of
 * five identical "Remove" buttons is the failure the role-and-name discipline
 * exists to prevent, and it would force a test to reach for a positional index.
 */
const Chip = ({
  label,
  onRemove,
}: {
  readonly label: string;
  readonly onRemove: () => void;
}) => {
  const { t } = useT("grid");

  return (
    <Badge variant="secondary" className="gap-1 py-1 pr-1 pl-2 font-normal">
      {label}
      <button
        type="button"
        aria-label={t("applied.remove", { label })}
        className="rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        onClick={onRemove}
      >
        <XIcon aria-hidden className="size-3.5" />
      </button>
    </Badge>
  );
};
