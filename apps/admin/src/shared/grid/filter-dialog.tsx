import { FilterIcon } from "lucide-react";
import { useState } from "react";

import type { FilterControlConfig } from "@/shared/resource/types";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  cn,
} from "@/shared/ui";

import type { ColumnFilterValue } from "./column-filters";
import { FilterControl } from "./filter-controls";

/**
 * The header filter icon and the dialog it opens (ADR-0039, `D4.4`).
 *
 * This replaces the always-visible filter row, and the complaint it answers is
 * concrete: a `dateRange` control is two date inputs side by side, so the
 * "Created" and "Last login" columns were sized by their filters rather than by
 * their data and every grid read wider and busier than its contents. On demand,
 * the header has nothing in it but headers.
 *
 * **The dialog commits on an explicit Apply**, and that is the one behaviour
 * that is not a straight re-housing. The row's per-keystroke debounce does not
 * transfer to a composition surface: an operator setting a date range types two
 * values, and live-committing after the first would refetch a half-meant query
 * — "half done" is a different question, not an almost-right one. Apply makes
 * one navigation carry one intent, and Clear is what it pairs with.
 *
 * Focus trapping, `Escape` and return-of-focus come free with the Dialog
 * primitive (ADR-0031); none of it is rebuilt here.
 */

export interface ColumnFilterDialogProps {
  readonly field: string;
  /** The column's header — the words the operator sees on screen. */
  readonly label: string;
  readonly config: FilterControlConfig;
  /** What the URL currently says about this column. `undefined` is unfiltered. */
  readonly value: ColumnFilterValue | undefined;
  /** Apply and Clear both come through here; Clear passes `undefined`. */
  readonly onCommit: (next: ColumnFilterValue | undefined) => void;
}

export const ColumnFilterDialog = ({
  field,
  label,
  config,
  value,
  onCommit,
}: ColumnFilterDialogProps) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  const active = value !== undefined;

  const commit = (next: ColumnFilterValue | undefined) => {
    setOpen(false);
    onCommit(next);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Re-seed on the way *in*, so an abandoned draft never survives to the
        // next opening: closing without Apply has to mean nothing happened.
        if (next) setDraft(value);
        setOpen(next);
      }}
    >
      {/*
       * A real `DialogTrigger`, not a `Button` with an `onClick` — and the
       * difference is the whole of the "return-of-focus comes free" claim
       * above. Radix's modal content overrides the default focus restore with
       * `context.triggerRef.current?.focus()`; with no Trigger mounted that ref
       * is null, the restore is suppressed rather than falling back, and Apply,
       * Clear and Escape all drop focus onto `<body>` — a keyboard operator
       * ejected to the top of the page by the act of filtering one column.
       *
       * This is the app's first in-place, button-opened dialog (the record
       * surfaces of ADR-0040 are route-driven), so it is also the first time
       * the door had to export `DialogTrigger` at all.
       */}
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "size-7 shrink-0",
            active && "bg-accent text-accent-foreground",
          )}
          /*
           * The state travels in the **accessible name**, which is a small
           * amendment to ADR-0039 and the honest reading of its own two
           * sentences. The ADR pins the name as "Filter by <header>" *and* asks
           * for the active state to reach assistive technology; on a control
           * that opens a dialog the name is the only channel that can carry it.
           * `aria-pressed` would say "toggle button" about something that
           * toggles nothing, and `data-active` alone is CSS a screen reader
           * never hears.
           */
          aria-label={
            active ? `Filter by ${label} (filtered)` : `Filter by ${label}`
          }
          data-active={active ? "true" : undefined}
        >
          <FilterIcon aria-hidden className={cn(!active && "opacity-50")} />
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-sm">
        {/*
         * A form, so Enter in a text box applies rather than doing nothing —
         * the keyboard path an operator will try first.
         */}
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            commit(draft);
          }}
        >
          <DialogHeader>
            <DialogTitle>Filter by {label}</DialogTitle>
            <DialogDescription>{hintFor(config)}</DialogDescription>
          </DialogHeader>

          <div>
            <FilterControl
              field={field}
              label={label}
              config={config}
              value={draft}
              onChange={setDraft}
            />
          </div>

          <DialogFooter>
            {/*
             * Clear removes **only this column's** filters — both halves of a
             * range — and is deliberately not the same button as Clear all,
             * which is the bar's and drops everything including `q`.
             */}
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                commit(undefined);
              }}
            >
              Clear
            </Button>
            <Button type="submit">Apply</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

/**
 * One sentence about what this kind of filter actually asks the server.
 *
 * The operators are made visible rather than implied: "contains" is what `like`
 * means to a person, and a range that includes both endpoints is worth saying
 * because the upper bound is silently pushed to end-of-day.
 */
const hintFor = (config: FilterControlConfig): string => {
  switch (config.kind) {
    case "text":
      return config.op === "like"
        ? "Matches rows containing this text, ignoring case."
        : "Matches rows equal to this value.";
    case "enum":
      return "Pick one value, or Any to remove the filter.";
    case "dateRange":
      return "Either bound may be left empty. Both days are included.";
    case "presence":
      return "A scope switch: it replaces the current rows rather than adding to them.";
  }
};
