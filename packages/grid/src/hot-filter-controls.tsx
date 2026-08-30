import type { Filter } from "@repo/contracts";

import { useKeyT, useT } from "@repo/i18n";
import { resolveOptions } from "@repo/resource";
import type { HotFilterConfig } from "@repo/resource";
import { Button } from "@repo/ui/components/button";
import { cn } from "@repo/ui/lib/utils";

import {
  hotFilterSelection,
  isPresenceOn,
  toggledHotFilter,
  toggledPresence,
} from "./hot-filters";

/**
 * The toolbar's hot filters (ADR-0039, `D4.4`).
 *
 * Stances, one press away — "active staff", "deleted only" — for the filters an
 * operator applies and releases many times a session and should not have to
 * open a dialog for. Everything they write goes through the same channel the
 * header dialogs write through, and everything they show is read back off the
 * URL, so the two surfaces on one field are two views of one entry.
 *
 * **Buttons with `aria-pressed`, not a `Toggle` primitive.** `@repo/ui` has no
 * toggle component and ADR-0031 makes adding one a deliberate act; a `<button>`
 * carrying `aria-pressed` is the same accessible object a toggle would build,
 * and it is what a test asserts against either way. If a second consumer ever
 * wants the styling, that is the moment to generate the primitive.
 *
 * **Drawn as a 30px segmented control since `D11.4`** (ADR-0054 §5, §3's
 * control heights): a bordered 30px track on `--muted` holding 26px segments,
 * the pressed one on `--primary-tint` in `--primary` — the same "selected"
 * vocabulary the active nav item and the selected row already speak, rather
 * than the grey `bg-accent` pill of `D4.4`. Nothing about *what* a press
 * writes moves; ADR-0039's channel and ADR-0052's chip both stand.
 */

/**
 * The track and its segments, as values rather than as prose.
 *
 * 30 = 26 (segment) + 2 (the track's own border) + 2 (its padding), which is
 * the arithmetic that makes a 26px chip and a 30px segment the same family of
 * shape at §3's two heights.
 *
 * The segment's `rounded-sm` inside the track's `rounded-md` is §2's scale
 * read the way a nested shape reads it — the inner radius is the outer one
 * less the padding between them, which is the scale's own next rung down. It
 * is the token and not the `4px` it computes to, because §2 puts the scale in
 * the sheet and a literal here is the defect the rule file names.
 */
const TRACK =
  "flex h-[30px] items-center gap-px rounded-md border bg-muted p-px";
const SEGMENT = "h-[26px] rounded-sm px-2.5 text-[13px] font-normal";

/**
 * The pressed state, **with its `dark:` twins**, and they are not decoration.
 *
 * `Button`'s own variants spell part of themselves under `dark:` — ghost has
 * `dark:hover:bg-accent/50`, outline has `dark:bg-input/30 dark:hover:bg-input/50`
 * and `dark:border-input`. `cn`'s merge is per-modifier-chain, so a plain
 * `bg-primary-tint` does not displace a `dark:bg-…`, and `.dark .x:hover` is
 * the more specific selector besides. Measured in Chrome before this line
 * existed: in dark, a pressed segment turned grey the moment the pointer was
 * over it, and a pressed presence stance never showed the tint at all — the
 * `--accent`/`--input` value winning both times. The tint is the state, so it
 * is written for both themes.
 */
const PRESSED =
  "bg-primary-tint text-primary hover:bg-primary-tint hover:text-primary dark:bg-primary-tint dark:hover:bg-primary-tint";

export interface HotFiltersProps {
  readonly hotFilters: readonly HotFilterConfig[];
  /** The URL's validated filters — the only source of what is pressed. */
  readonly filters: readonly Filter[];
  /** One field's filters, replaced whole; the grid navigates. */
  readonly onChange: (field: string, next: readonly Filter[]) => void;
}

export const HotFilters = ({
  hotFilters,
  filters,
  onChange,
}: HotFiltersProps) => (
  <>
    {hotFilters.map((config) =>
      config.kind === "presence" ? (
        <PresenceHotFilter
          key={`${config.field}:null`}
          config={config}
          filters={filters}
          onChange={onChange}
        />
      ) : (
        <EnumHotFilter
          key={`${config.field}:${config.op}`}
          config={config}
          filters={filters}
          onChange={onChange}
        />
      ),
    )}
  </>
);

const EnumHotFilter = ({
  config,
  filters,
  onChange,
}: {
  readonly config: Extract<HotFilterConfig, { kind: "enum" }>;
  readonly filters: readonly Filter[];
  readonly onChange: (field: string, next: readonly Filter[]) => void;
}) => {
  const { t } = useT("grid");
  const tk = useKeyT();
  const options = resolveOptions(config.options, tk);
  const selection = hotFilterSelection(filters, config);

  return (
    /*
     * A named group, because the buttons inside are "Active" and "Disabled" —
     * words that mean nothing on their own once a second group is beside them.
     * It is not rendered as a visible legend: the toolbar has no room for one
     * and the option words carry the meaning on screen.
     *
     * `"<label> filter"` rather than the bare label, and that is not cosmetic.
     * A group called "Status" collides with the *form* field called "Status" on
     * every screen where a record surface opens over the grid — the grid stays
     * mounted underneath (ADR-0040), so both are in the document at once and
     * `getByLabelText("Status")` finds two things. Naming what the control is,
     * not only what it is about, is also what a screen reader needs to hear
     * when it lands on it out of context.
     */
    <div
      role="group"
      aria-label={t("filter.group", { label: tk(config.label) })}
      data-slot="hot-filter"
      className={TRACK}
    >
      {options.map((option) => {
        const pressed = selection.includes(option.value);

        return (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant="ghost"
            aria-pressed={pressed}
            className={cn(SEGMENT, pressed ? PRESSED : "text-muted-foreground")}
            onClick={() => {
              onChange(
                config.field,
                toggledHotFilter(config, selection, option.value),
              );
            }}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
};

const PresenceHotFilter = ({
  config,
  filters,
  onChange,
}: {
  readonly config: Extract<HotFilterConfig, { kind: "presence" }>;
  readonly filters: readonly Filter[];
  readonly onChange: (field: string, next: readonly Filter[]) => void;
}) => {
  const tk = useKeyT();
  const on = isPresenceOn(filters, config);

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-pressed={on}
      data-slot="hot-filter"
      /*
       * A presence stance is one segment, so it takes the *track's* 30px and
       * the segment's type rather than being wrapped in a track of its own: a
       * one-segment segmented control is a bordered button with extra DOM, and
       * the extra DOM is what a screen reader would have to walk past. Pressed
       * speaks the same tint as a segment above.
       */
      className={cn(
        "h-[30px] rounded-md px-2.5 text-[13px] font-normal",
        on
          ? `${PRESSED} border-primary/40 dark:border-primary/40`
          : "text-muted-foreground",
      )}
      onClick={() => {
        onChange(config.field, toggledPresence(config, on));
      }}
    >
      {tk(config.label)}
    </Button>
  );
};
