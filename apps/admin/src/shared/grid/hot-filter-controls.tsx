import type { Filter } from "@repo/contracts";

import { useT } from "@/shared/i18n";
import { resolveOptions } from "@/shared/resource/config";
import type { HotFilterConfig } from "@/shared/resource/types";
import { Button, cn } from "@/shared/ui";

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
 */

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
  const options = resolveOptions(config.options);
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
      aria-label={t("filter.group", { label: config.label })}
      data-slot="hot-filter"
      className="flex items-center gap-0.5 rounded-md border p-0.5"
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
            className={cn("h-7", pressed && "bg-accent text-accent-foreground")}
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
  const on = isPresenceOn(filters, config);

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-pressed={on}
      data-slot="hot-filter"
      className={cn("h-8", on && "bg-accent text-accent-foreground")}
      onClick={() => {
        onChange(config.field, toggledPresence(config, on));
      }}
    >
      {config.label}
    </Button>
  );
};
