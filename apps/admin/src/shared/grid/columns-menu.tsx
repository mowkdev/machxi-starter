import { ArrowDownIcon, ArrowUpIcon, Columns3Icon } from "lucide-react";

import { useT } from "@/shared/i18n";
import {
  Button,
  Checkbox,
  Label,
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
  Separator,
} from "@/shared/ui";

/**
 * The Columns surface (ADR-0041, `D4.5`).
 *
 * Show and hide, reorder, and reset — the two preferences a header edge cannot
 * express. Sizing has its own gesture on the header; these do not, and inventing
 * one would mean a drag-and-drop dependency this repository has never had a
 * reason to take, fighting two surfaces that already own the header (the
 * sortable-header click of ADR-0035 and ADR-0037's sticky positioning). The day
 * reordering frequency proves a list too slow is the day that dependency gets
 * argued for.
 *
 * **A `Popover` holding a real list, not a `DropdownMenu`** — a `D4.5` decision
 * on a question ADR-0041 left to the implementation by writing only "menu". A
 * Radix menu treats each item as one actionable unit with a roving tabindex and
 * closes on activation; a row here is three controls (a checkbox and two
 * reorder buttons) that are used in sequence, so a menu would have to be talked
 * out of both behaviours with `onSelect` preventions and nested focus traps. A
 * Popover is a plain container and the row is ordinary DOM.
 *
 * **Structural columns are absent, not disabled** (ADR-0041). The caller passes
 * only the movable ones, so the selection and row-actions columns cannot be
 * hidden or moved because they are not offered — no flag to forget, and no
 * disabled control that raises the question of why.
 */

export interface ColumnsMenuEntry {
  readonly id: string;
  /** The column's header, which is the word the operator sees on screen. */
  readonly label: string;
  readonly isVisible: boolean;
}

export interface ColumnsMenuProps {
  /** The movable columns, in their current render order. */
  readonly entries: readonly ColumnsMenuEntry[];
  readonly onToggle: (id: string, visible: boolean) => void;
  readonly onMove: (id: string, direction: -1 | 1) => void;
  readonly onReset: () => void;
  /** Whether anything currently deviates from the config. */
  readonly isDirty: boolean;
}

/**
 * The last visible column cannot be hidden.
 *
 * A grid with no columns is not a preference, it is a blank rectangle where the
 * data was — and the one control that could undo it is inside this menu, which
 * is a worse place to discover the mistake than to prevent it.
 */
const isLastVisible = (
  entries: readonly ColumnsMenuEntry[],
  entry: ColumnsMenuEntry,
): boolean =>
  entry.isVisible && entries.filter((other) => other.isVisible).length === 1;

export const ColumnsMenu = ({
  entries,
  onToggle,
  onMove,
  onReset,
  isDirty,
}: ColumnsMenuProps) => {
  const { t } = useT("grid");

  if (entries.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8">
          <Columns3Icon aria-hidden />
          {t("columns.label")}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-64 p-2">
        <PopoverTitle className="px-2 py-1.5 text-sm font-medium">
          {t("columns.label")}
        </PopoverTitle>

        <div className="flex flex-col py-1">
          {entries.map((entry, index) => (
            <div
              key={entry.id}
              className="flex items-center gap-2 rounded-sm px-2 py-1 hover:bg-accent"
            >
              <Checkbox
                id={`column-${entry.id}`}
                checked={entry.isVisible}
                disabled={isLastVisible(entries, entry)}
                onCheckedChange={(checked) => {
                  onToggle(entry.id, checked === true);
                }}
              />
              <Label
                htmlFor={`column-${entry.id}`}
                className="min-w-0 flex-1 truncate font-normal"
              >
                {entry.label}
              </Label>

              {/*
               * Named per column, not "Move up" twelve times over. The
               * role-and-name discipline is what keeps a test — and a screen
               * reader — from having to count rows to know which column a
               * button moves.
               */}
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label={t("columns.moveUp", { column: entry.label })}
                disabled={index === 0}
                onClick={() => {
                  onMove(entry.id, -1);
                }}
              >
                <ArrowUpIcon aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label={t("columns.moveDown", { column: entry.label })}
                disabled={index === entries.length - 1}
                onClick={() => {
                  onMove(entry.id, 1);
                }}
              >
                <ArrowDownIcon aria-hidden />
              </Button>
            </div>
          ))}
        </div>

        <Separator className="my-1" />

        {/*
         * Disabled while nothing deviates, because Reset then has nothing to
         * do and an enabled control that does nothing is the affordance
         * ADR-0038 spent a step removing from toolbars.
         */}
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          disabled={!isDirty}
          onClick={onReset}
        >
          {t("columns.reset")}
        </Button>
      </PopoverContent>
    </Popover>
  );
};
