import { THEMES, type Theme } from "@repo/contracts";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";

import { useKeyT, useT, type TranslationKey } from "@/shared/i18n";
import { useTheme } from "@/shared/theme";
import { SettingsOptions } from "@/shared/ui";

/**
 * Choosing how the panel is painted (ADR-0045 §Theme, as superseded on this
 * one point by ADR-0053 §2).
 *
 * **This was `ThemeMenuItems` until `D11.10`**, and the only thing that
 * changed is the surface it draws on: `/account/preferences` is the one
 * inventory of the operator's preferences, so the control leaves the account
 * menu and becomes a page control. What did *not* change is anything below it
 * — `useTheme().setTheme` still paints, still writes the local cache for the
 * next first paint, and still hands the account half to ADR-0045's coalescing
 * writer, and this component still cannot tell whether there is an account.
 * That last property is why the signed-out login screen's theming is
 * unaffected by a move that retires the menu it used to hang in.
 *
 * **The three options are the contracts tuple**, not a list written here:
 * `THEMES` is declared once and consumed by `pgEnum`, by the request body and
 * by this radio group (ADR-0023), so D7-shaped work that adds a value cannot
 * leave a control behind.
 *
 * The `cards` layout is the plan's word for this set and ADR-0054 §7's
 * geometry as amended at `D11.10`: tiles across the pane, each on §3's 44
 * settings-option rung. `SettingsOptions` owns all of it — see
 * `shared/ui/settings-options.tsx` for why the group is a native fieldset of
 * radios rather than a Radix primitive.
 */

/**
 * One key per theme, `Record<Theme, …>` so the contracts tuple still cannot
 * leave a control behind (`D7.4`).
 *
 * A table rather than a `t(`theme.${option}`)` template, and the reason is the
 * one ADR-0046 §7 gives for configs generally: a composed key is checked by
 * nothing, while these three are literals the compiler measures against the
 * `en` catalogue — and `Record<Theme, …>` makes a fourth theme a red build
 * here rather than a raw key on the card.
 */
const THEME_LABEL_KEYS: Record<Theme, TranslationKey> = {
  light: "settings:theme.light",
  dark: "settings:theme.dark",
  system: "settings:theme.system",
};

const THEME_ICONS: Record<Theme, typeof SunIcon> = {
  light: SunIcon,
  dark: MoonIcon,
  system: MonitorIcon,
};

export const ThemeCards = () => {
  /*
   * `settings`, not a namespace of this feature's own (ADR-0046 §3): the
   * appearance control, the density mode and the language switch are three
   * views of one account settings row, so their copy is catalogued together —
   * which is also why they share a section rather than a namespace each.
   */
  const { t } = useT("settings");
  const tk = useKeyT();
  const { theme, setTheme } = useTheme();

  return (
    <SettingsOptions
      label={t("appearance.title")}
      layout="cards"
      name="theme"
      onChange={setTheme}
      options={THEMES.map((option) => ({
        value: option,
        label: tk(THEME_LABEL_KEYS[option]),
        icon: THEME_ICONS[option],
      }))}
      value={theme}
    />
  );
};
