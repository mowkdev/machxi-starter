import { THEMES, type Theme } from "@repo/contracts";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";

import { useKeyT, useT, type TranslationKey } from "@/shared/i18n";
import { useTheme } from "@/shared/theme";
import { SettingsOptions } from "@/shared/ui";

/**
 * Choosing how the app is painted (`D12.7`; ADR-0045 §Theme as superseded on
 * this one point by ADR-0053 §2).
 *
 * **This app never had the menu the admin's control left**, which is worth
 * saying because it is the second-consumer claim landing the easy way round:
 * ADR-0053 §2 moved the theme out of the account menu and made
 * `/account/preferences` the one inventory, and this app was built after that
 * decision — so its account control shipped at `D12.5` as identity-and-exit
 * with no radio items to retire, and the control is a page control from its
 * first render.
 *
 * What is below it is unchanged from the record: `useTheme().setTheme` paints,
 * writes the device cache for the next first paint, and hands the account half
 * to the coalescing writer — and this component cannot tell whether there is an
 * account. That last property is why the signed-out sign-in screen's theming
 * owes nothing to this file.
 *
 * **The three options are the contracts tuple**, not a list written here:
 * `THEMES` is declared once and consumed by `pgEnum`, by the request body and
 * by this radio group (ADR-0023), so a value added later cannot leave a control
 * behind.
 */

/**
 * One key per theme, `Record<Theme, …>` so the contracts tuple still cannot
 * leave a control behind.
 *
 * A table rather than a `t(`theme.${option}`)` template, and the reason is the
 * one ADR-0046 §7 gives for configs generally: a composed key is checked by
 * nothing, while these three are literals the compiler measures against the
 * `en` catalogue — and `Record<Theme, …>` makes a fourth theme a red build here
 * rather than a raw key on the card.
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
