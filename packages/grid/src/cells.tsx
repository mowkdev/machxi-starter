import { MoreHorizontalIcon } from "lucide-react";

import { useKeyT, useT } from "@repo/i18n";
import { optionLabel } from "@repo/resource";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import { cn } from "@repo/ui/lib/utils";

import { DENSITY_BADGE, useRowDensity } from "./density";
import { EMPTY_CELL } from "./formatters";
import type { CellRendererProps } from "./types";

/**
 * The named cell renderers (ADR-0035 §The grid registry).
 *
 * **Every entry here is resource-agnostic, and that is the rule that lets them
 * live in `shared` at all** (ADR-0032): `rolesList` renders a string array as
 * badges, `statusBadge` colours an enum label — nothing in this file knows what
 * a staff member is. A renderer that needs a resource's semantics is not a
 * registry entry; it belongs to the entity or feature that has them.
 */

/**
 * Which statuses read as settled, waiting or neither.
 *
 * A vocabulary of *words*, not of resources: `active` is settled and `invited`
 * is waiting, whichever table the value came from. Both populations' status
 * enums (ADR-0017) are covered — staff `active`/`invited`/`disabled`, users
 * `active`/`pending_verification`/`disabled` — and an unlisted value renders
 * neutral rather than throwing, so a status added to contracts appears in grey
 * instead of breaking the grid.
 *
 * **The negative list retired at `D11.2`** (ADR-0054 §4). `disabled` used to
 * render `destructive`, which spent the palette's one alarm colour on a row's
 * ordinary resting state; the record says *neutral* for it, and destructive
 * stays for actions that destroy something.
 */
const SETTLED = ["active", "enabled", "verified"];
const WAITING = ["invited", "pending", "pending_verification"];

/**
 * The dot's colour, as a class rather than a variant.
 *
 * `--success` and `--warning` are §2's two status tokens and are reached the
 * way every other colour here is — through the theme, so both themes answer
 * without a second value to maintain. Neutral is `--muted-foreground`, the
 * same grey the cell's own secondary text uses.
 */
const dotToneFor = (value: string): string => {
  if (SETTLED.includes(value)) return "bg-success";
  if (WAITING.includes(value)) return "bg-warning";

  return "bg-muted-foreground";
};

/**
 * A value rendered from nothing but itself.
 *
 * `StatusBadge` and `RolesList` read only `value`, and saying so in the type is
 * what lets a screen with no grid on it use the same vocabulary — the profile
 * page renders a status and a roles list, and a hand-rolled pair there had
 * already disagreed with these about `invited` (D3.9 review). A function taking
 * fewer props still satisfies {@link CellRenderer}, so the registry is
 * unaffected.
 */
export interface ValueOnlyProps {
  readonly value: unknown;
}

/**
 * An enum value as a 6px dot beside its word (ADR-0054 §4, `D11.2`).
 *
 * **The same resource-agnostic renderer, re-drawn.** It was a filled `Badge`,
 * which put a saturated pill in every status cell of every row and made the
 * quietest column on the screen the loudest. Instrument spends colour on the
 * *state* and leaves the label as text: a dot in `--success`, `--warning` or
 * neutral, and the word in the cell's own type. The registry key stays
 * `statusBadge` — that is config vocabulary a resource spells (ADR-0035), and
 * renaming it would edit every config to change a picture.
 *
 * The words come from `common:options.<value>` (`D7.4`, ADR-0046 §7), not from
 * `humanize` alone: this renderer is handed a cell value and nothing else, so
 * there is no config for a label to travel on, and leaving it un-catalogued
 * would have been a Latvian grid with `Active` in every status cell. `humanize`
 * survives as the `defaultValue` inside {@link optionLabel}, which is what
 * keeps a status added to `@repo/contracts` rendering a word rather than a key.
 */
export const StatusBadge = ({ value }: ValueOnlyProps) => {
  const t = useKeyT();

  if (typeof value !== "string" || value === "") return <>{EMPTY_CELL}</>;

  return (
    <span className="inline-flex items-center gap-2" data-slot="status-dot">
      {/*
       * `aria-hidden`, and the label carries the meaning: the dot is a second
       * encoding of the word beside it, so a screen reader that announced both
       * would announce the status twice — and a colour that was the *only*
       * encoding would be the accessibility defect ADR-0036's role-and-label
       * discipline exists to catch.
       */}
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full", dotToneFor(value))}
      />
      {optionLabel(t, value)}
    </span>
  );
};

/**
 * A string array as badges — roles, tags, anything repeated and short.
 *
 * Mono and 5px-radius since `D11.2` (ADR-0054 §3/§4): a role is an identifier
 * rather than prose, and §2's radius scale puts a badge at `md` — the `Badge`
 * primitive's own `rounded-full` is the one value that scale's "nothing rounder
 * than 8" forbids, and this is the sanctioned surface that gets to say so
 * without editing a generated component.
 *
 * **It is also the grid's one in-row badge, so it is what §6's "badge padding"
 * names** (`D11.6`): 26 × 8 Comfortable, 22 × 6 Compact, read off the row's
 * mode through the context rather than taken as a prop, because a registry
 * cell renderer has no call site to be handed one (ADR-0035). The status is a
 * dot since `D11.2` and the Filtered-by chips are chrome outside the table, so
 * neither moves with the rows.
 */
export const RolesList = ({ value }: ValueOnlyProps) => {
  const t = useKeyT();
  const density = useRowDensity();
  const values = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];

  if (values.length === 0) return <>{EMPTY_CELL}</>;

  return (
    <span className="flex flex-wrap gap-1">
      {values.map((entry) => (
        <Badge
          key={entry}
          variant="outline"
          className={cn("rounded-md font-mono", DENSITY_BADGE[density])}
        >
          {optionLabel(t, entry)}
        </Badge>
      ))}
    </span>
  );
};

/**
 * The per-row action menu, whose handlers come from the table `meta`.
 *
 * The split is ADR-0035's: the entity's config says *there is an actions
 * column*, the feature rendering the grid says *what the actions do*. So this
 * component reads `meta.rowActions` rather than taking a prop, and the config
 * stays free of functions.
 *
 * Renders nothing when no action applies, rather than an empty menu that opens
 * onto a blank panel.
 */
export const RowActions = ({ row, rowId, meta }: CellRendererProps) => {
  const { t } = useT("grid");
  // Per row, before anything else: an action `isHidden` refuses on this row
  // does not exist here, and a row every action hides gets no trigger at all
  // rather than a button opening onto a blank panel.
  const actions = (meta.rowActions ?? []).filter(
    (action) => action.isHidden?.(row) !== true,
  );

  if (actions.length === 0) return null;

  const ordered = [
    ...actions.filter((action) => action.destructive !== true),
    ...actions.filter((action) => action.destructive === true),
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/*
         * The accessible name carries the row's id, because a table of twenty
         * rows otherwise has twenty controls called "Row actions" — which is
         * precisely what the role-and-label discipline exists to prevent, and
         * what would force every test to reach for a positional index. The id
         * comes from `getRowId`, so it is the resource's own identifier.
         */}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("selection.rowActions", { id: rowId })}
        >
          <MoreHorizontalIcon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {ordered.map((action) => (
          <DropdownMenuItem
            key={action.key}
            variant={action.destructive === true ? "destructive" : "default"}
            disabled={action.isDisabled?.(row) ?? false}
            onSelect={() => {
              action.onSelect(row);
            }}
          >
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
