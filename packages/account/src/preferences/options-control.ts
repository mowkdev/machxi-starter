import type { ComponentType, ReactNode } from "react";

/**
 * The control the three preference cards render, as a slot (`D22.2`,
 * ADR-0077 §2).
 *
 * The control itself is `@repo/app-kit`'s `SettingsOptions` — the native radio
 * group with ADR-0054's 44px rung — and this package depends on the kit never.
 * So the cards are built over the *shape* below and each app's feature slice
 * hands them the control through its own `shared/ui` door, which is the same
 * move the settings gate makes for the principal-cache boundary.
 *
 * The props are the kit's member for member, so its component is assignable
 * here without either package naming the other.
 */
export interface PreferenceOption<TValue extends string> {
  readonly value: TValue;
  readonly label: string;
  /**
   * ADR-0053 §2's mitigation where it applies: a stable glyph is what makes
   * the preferences reachable from inside a language a person cannot read.
   */
  readonly icon?: ComponentType<{ readonly className?: string }>;
}

export interface PreferenceOptionsProps<TValue extends string> {
  /** The group's accessible name — the card's title, not a second heading. */
  readonly label: string;
  /** The radio `name`; exclusivity and arrow-key roving are the browser's. */
  readonly name: string;
  readonly layout: "cards" | "rows";
  readonly options: readonly PreferenceOption<TValue>[];
  readonly value: TValue;
  readonly onChange: (value: TValue) => void;
}

export type PreferenceOptionsControl = <TValue extends string>(
  props: PreferenceOptionsProps<TValue>,
) => ReactNode;
