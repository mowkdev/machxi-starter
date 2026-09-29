import { useTheme } from "@repo/app-services";
import { THEMES, type Theme } from "@repo/contracts";
import { useKeyT, useT, type TranslationKey } from "@repo/i18n";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";

import type { PreferenceOptionsControl } from "./options-control";

/**
 * Choosing how the app is painted (ADR-0045 §Theme, as superseded on this one
 * point by ADR-0053 §2) — one card for both apps since `D22.2` (ADR-0077 §2).
 *
 * `/account/preferences` is the one inventory of a person's preferences, so
 * the control is a page control. `useTheme().setTheme` paints, writes the
 * device cache for the next first paint, and hands the account half to
 * ADR-0045's coalescing writer — and this component cannot tell whether there
 * is an account. That last property is why the signed-out sign-in screen's
 * theming owes nothing to this file.
 *
 * **The three options are the contracts tuple**, not a list written here:
 * `THEMES` is declared once and consumed by `pgEnum`, by the request body and
 * by this radio group (ADR-0023), so a value added later cannot leave a
 * control behind.
 *
 * The `cards` layout is ADR-0054 §7's geometry as amended at `D11.10`: tiles
 * across the pane, each on §3's 44 settings-option rung. The control owns all
 * of it — see `./options-control` for why it arrives as a slot.
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
  light: "accountClient:preferences.theme.light",
  dark: "accountClient:preferences.theme.dark",
  system: "accountClient:preferences.theme.system",
};

const THEME_ICONS: Record<Theme, typeof SunIcon> = {
  light: SunIcon,
  dark: MoonIcon,
  system: MonitorIcon,
};

export const createThemeCards = (Options: PreferenceOptionsControl) => {
  const ThemeCards = () => {
    /*
     * One namespace for the three cards (ADR-0046 §3): the appearance control,
     * the density mode and the language switch are three views of one account
     * settings row, so their copy is catalogued together.
     */
    const { t } = useT("accountClient");
    const tk = useKeyT();
    const { theme, setTheme } = useTheme();

    return (
      <Options
        label={t("preferences.appearance.title")}
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

  return ThemeCards;
};
