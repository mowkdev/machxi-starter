import type { ComponentType } from "react";

import { cn } from "@repo/ui/lib/utils";

/**
 * One account setting, offered as a set of exclusive options (`D12.7`,
 * ADR-0053 §2, ADR-0054 §3/§7).
 *
 * Not a re-export, so it lives beside the door rather than in it (see
 * `index.ts`). What it adds is the **geometry three features would otherwise
 * each spell for themselves**: the Preferences section holds a theme control, a
 * density control and a language control, and they are the same control with
 * different words in it. Three copies of the 44px rung and the selected
 * treatment is three places for them to drift.
 *
 * **It is `apps/admin`'s file, and that is recorded rather than glossed** (the
 * plan's finding 10). Every line below is ADR-0054 geometry with no app
 * knowledge in it, which makes it the clearest `@repo/ui/compositions`
 * candidate this deliverable has produced — and it is copied for the reason
 * every other duplication here was copied: this deliverable's rule is that a
 * `packages/*` diff is named before it is made.
 *
 * **It is a native radio group, not a Radix one.** `packages/ui` ships no radio
 * primitive and ADR-0047's regime 2 would have this step run the shadcn CLI and
 * take `@radix-ui/react-radio-group` as a runtime dependency — for a control
 * the platform already implements completely: exclusivity within a `name`,
 * arrow-key roving focus, `aria-checked`, and a label association that comes
 * free from wrapping the input. The input is `sr-only` rather than `hidden` or
 * absent, because it is the control: hiding it would take the keyboard and the
 * screen reader with it, and re-implementing either on a `<button role="radio">`
 * is how a control ends up announceable but not operable.
 *
 * The `<fieldset>` is what makes the set a set. It is named by `label` rather
 * than by a `<legend>` because the name is already on screen — it is the card's
 * title above it — and a legend would render it twice.
 *
 * **Two layouts, one rung** (ADR-0054 §7): `cards` wraps the options across the
 * pane and `rows` stacks them full width, and both are 44 high, which is §3's
 * `settings option row`. The difference is arrangement, not size — a two-value
 * mode reads as a pair of tiles and a language list reads as a list, and
 * neither is a reason for a second height.
 */

/** A `lucide-react` icon, described by what this component does with it. */
type OptionIcon = ComponentType<{ readonly className?: string }>;

export interface SettingsOption<TValue extends string> {
  readonly value: TValue;
  readonly label: string;
  /**
   * ADR-0053 §2's mitigation where it applies, and absent where it does not: a
   * stable glyph is what makes the preferences reachable from inside a language
   * the customer cannot read, and the locale options are the one set that is
   * legible on its own because it is self-named.
   */
  readonly icon?: OptionIcon;
}

export interface SettingsOptionsProps<TValue extends string> {
  /** The group's accessible name — the card's title, not a second heading. */
  readonly label: string;
  /** The radio `name`; exclusivity and arrow-key roving are the browser's. */
  readonly name: string;
  readonly layout: "cards" | "rows";
  readonly options: readonly SettingsOption<TValue>[];
  readonly value: TValue;
  readonly onChange: (value: TValue) => void;
}

/**
 * The option's own box: 44 high at the base radius, on §3's body rung.
 *
 * The selected treatment is **borrowed rather than invented** — an inset 2px
 * bar in `--primary` over `--primary-tint`, which is ADR-0054 §5's sidebar item
 * and §4's selected grid row, and which this app's account section links
 * already borrowed at `D12.6`. Three visual languages for "the one you are on"
 * would be the design disagreeing with itself; the ring is the focus indicator
 * and the bar is the state, so the two never have to mean the same thing.
 *
 * **`SELECTED` spells its own `hover:` twins.** `cn`'s merge is per modifier
 * chain, so a plain `bg-primary-tint` does not displace `hover:bg-accent` above
 * — and `.hover\\:bg-accent:hover` is the more specific selector besides, so
 * the option a customer is *on* would turn grey the moment the pointer reached
 * it, leaving only the bar.
 */
const OPTION =
  "flex h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground has-[:focus-visible]:border-ring has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50";

const SELECTED =
  "bg-primary-tint text-foreground hover:bg-primary-tint hover:text-foreground shadow-[inset_2px_0_0_var(--primary)]";

export const SettingsOptions = <TValue extends string>({
  label,
  name,
  layout,
  options,
  value,
  onChange,
}: SettingsOptionsProps<TValue>) => (
  <fieldset
    aria-label={label}
    /*
     * `min-w-0` is not decoration: the UA stylesheet gives `<fieldset>` a
     * `min-width: min-content` that Tailwind's preflight does not reset, so
     * without it a long option label makes the group wider than the card it
     * sits in rather than making the label truncate. The pseudo-locale build
     * lengthens every string, which is exactly where that would first show.
     */
    className={cn(
      "flex min-w-0 gap-2",
      layout === "cards" ? "flex-wrap" : "flex-col",
    )}
  >
    {options.map(({ value: option, label: optionLabel, icon: Icon }) => (
      <label
        className={cn(
          OPTION,
          /*
           * `flex-1` with a floor rather than a column count: the sets are two
           * and three options long, and a `grid-cols-3` would leave the density
           * pair a hole to sit beside. The floor is what stops a wrapped tile
           * collapsing to its label.
           */
          layout === "cards" && "min-w-32 flex-1",
          option === value && SELECTED,
        )}
        key={option}
      >
        <input
          checked={option === value}
          className="sr-only"
          name={name}
          onChange={() => {
            onChange(option);
          }}
          type="radio"
          value={option}
        />
        {/* Sized through the prop rather than by a `[&>svg]:size-4` on the
            label, which is the honest one: an icon component is not promised to
            render a bare `<svg>` root, and one that wraps it would ship
            unsized. */}
        {Icon === undefined ? null : <Icon className="size-4 shrink-0" />}
        {/* `min-w-0` for the reason the group carries one: a flex item will not
            shrink below its content's min-content width, so `truncate` alone is
            a class that does nothing on nowrap text. */}
        <span className="min-w-0 truncate">{optionLabel}</span>
      </label>
    ))}
  </fieldset>
);
