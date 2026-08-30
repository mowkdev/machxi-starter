import type { Filter } from "@repo/contracts";
import { XIcon } from "lucide-react";

import { useKeyT, useT } from "@repo/i18n";
import type { ColumnConfig } from "@repo/resource";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";

import { chipsForState } from "./filter-chips";

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
 *
 * **Every applied filter gets a chip, hot ones included** (ADR-0052 §Visible
 * state, `D10.2`). ADR-0039 suppressed the chip while a hot-filter button
 * displayed the same entry, to avoid saying one thing twice; the operator's
 * call is that this bar is the inventory, and an inventory with an exception is
 * one you have to read twice to trust. The duplication is accepted: a pressed
 * button and a chip now say the same thing, and both remove it. What ADR-0039
 * decided about *this* bar — one chip per `Filter`, removal semantics, the live
 * region, and reading from the URL rather than the configs — stands unchanged.
 */

export interface AppliedFiltersProps {
  /** The URL's validated filters — every one gets a chip or a pressed button. */
  readonly filters: readonly Filter[];
  /** ADR-0014's `q`. Empty means no search chip. */
  readonly q: string;
  /** Labels for the filters a column owns. Never membership. */
  readonly columns: readonly (readonly [string, ColumnConfig])[];
  readonly onRemoveFilter: (filter: Filter) => void;
  readonly onRemoveSearch: () => void;
  readonly onClearAll: () => void;
}

export const AppliedFilters = ({
  filters,
  q,
  columns,
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
  const { t: tCommon } = useT("grid");
  const tk = useKeyT();

  /*
   * Unfiltered since `D10.2`: what `chipsForState` returns is what renders.
   * The hot-filter suppression that used to sit here — and the
   * `displayedByHotFilters` function behind it, deleted with its last consumer
   * — is retired by ADR-0052, and with it the one case where reading this bar
   * did not answer "what am I looking at?" on its own.
   */
  const chips = chipsForState(filters, columns, tk);

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
       * The row renders whenever anything is *applied*, and since `D10.2` that
       * is the same as "there are chips or a search term" — every filter has a
       * chip now. The condition stays counted from `filters` rather than from
       * `chips.length` because `q` is applied without being a `Filter`, and
       * Clear all still clears hot filters too: they are filters, not a
       * separate mechanism.
       */}
      {applied === 0 ? null : (
        <div
          data-slot="grid-applied-filters"
          /*
           * The **"Filtered by" band** since `D11.4` (ADR-0054 §5): 40px, the
           * inset's `px-4` gutter it took at `D11.3`, and a caps label naming
           * what the row is. `min-h-10` rather than `h-10` for the toolbar
           * band's reason — `flex-wrap` is what keeps a screenful of chips
           * inside the frame, and a fixed height would let the second row
           * spill out of the band instead of growing it. `py-1.5` pads the
           * wrapped case; 6 + 26 + 6 is under the floor, so one row of chips
           * still measures exactly 40.
           */
          className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 px-4 py-1.5"
        >
          {/*
           * §3's 11/16·600·0.07em caps, the same voice the column heads speak
           * in (`D11.2`) — it is the band's own label rather than a chip, so
           * it is a `span` and not a control, and it carries no `:` because
           * the chips beside it are the sentence's object.
           */}
          <span
            data-slot="grid-applied-filters-label"
            className="text-[11px] leading-4 font-semibold tracking-[0.07em] text-muted-foreground uppercase"
          >
            {t("applied.label")}
          </span>

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

          {/*
           * Underlined text, not a button-shaped button (ADR-0054 §5,
           * `D11.4`): the band's one destructive-ish affordance reads as a
           * link so it does not compete with the chips for the eye, and the
           * underline is permanent rather than on hover — a bare word in
           * `--primary` beside tinted chips is not obviously pressable.
           *
           * `h-6` and not `h-auto`: a 13px line box is a ~19px pointer target,
           * and this is a standalone control in a band rather than a word
           * inside a sentence, so WCAG 2.2's 24×24 minimum applies with no
           * inline exception to claim. No ADR here decides target size — that
           * is the operator's to make a standing rule if they want one — but
           * 24 costs nothing inside a 40px band.
           */}
          <Button
            variant="link"
            size="sm"
            className="h-6 px-0 text-[13px] underline underline-offset-4"
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
    /*
     * 26px on `--primary-tint` at §2's `md` rung (ADR-0054 §5, `D11.4`) — the
     * same shape `D11.2` gave the grid's role badges, in the tint the pressed
     * segment and the selected row use, so "this filter is on" says one thing
     * wherever it is said. The `variant` stays `secondary` and the ground and
     * ink are overridden at the call site: `Badge` is a generated primitive
     * and ADR-0047 keeps it byte-identical, so a "tint" variant is not this
     * step's to add.
     */
    <Badge
      variant="secondary"
      className="h-[26px] gap-1 rounded-md bg-primary-tint py-0 pr-1 pl-2.5 font-normal text-foreground"
    >
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
