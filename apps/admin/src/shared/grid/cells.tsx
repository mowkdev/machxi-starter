import { MoreHorizontalIcon } from "lucide-react";

import { useKeyT, useT } from "@/shared/i18n";
import { optionLabel } from "@/shared/resource/config";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui";

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
 * Which statuses read as good, bad or neutral.
 *
 * A vocabulary of *words*, not of resources: `active` is encouraging and
 * `disabled` is not, whichever table the value came from. Both populations'
 * status enums (ADR-0017) are covered by the three lists, and an unlisted value
 * renders neutral rather than throwing — a status added to contracts should
 * appear in grey, not break the grid.
 */
const POSITIVE = ["active", "enabled", "verified"];
const NEGATIVE = ["disabled", "revoked", "deleted", "suspended"];

const badgeVariantFor = (
  value: string,
): "default" | "destructive" | "secondary" => {
  if (POSITIVE.includes(value)) return "default";
  if (NEGATIVE.includes(value)) return "destructive";

  return "secondary";
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
 * An enum value as a coloured label.
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
    <Badge variant={badgeVariantFor(value)}>{optionLabel(t, value)}</Badge>
  );
};

/** A string array as badges — roles, tags, anything repeated and short. */
export const RolesList = ({ value }: ValueOnlyProps) => {
  const t = useKeyT();
  const values = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];

  if (values.length === 0) return <>{EMPTY_CELL}</>;

  return (
    <span className="flex flex-wrap gap-1">
      {values.map((entry) => (
        <Badge key={entry} variant="outline">
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
  const actions = meta.rowActions ?? [];

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
