import { LOCALES, type Locale } from "@repo/contracts";

import { useKeyT, useLocale, useT, type TranslationKey } from "@/shared/i18n";
import { SettingsOptions } from "@/shared/ui";

/**
 * Choosing the language the app speaks (`D12.7`; ADR-0046 §4, and the surface
 * is ADR-0053 §2's).
 *
 * `useLocale` owns both halves — the running instance and the device cache
 * immediately, the account row through the publisher `app/providers` installs —
 * and this component cannot tell whether there is an account.
 *
 * **ADR-0053 §2's escape-hatch mitigation matters more here than it does in the
 * admin**, and that is the one thing this file has to say that the admin's does
 * not. An operator stranded in a language they cannot read works for the
 * company that installed the panel; a customer stranded in one has nobody to
 * ask. So both mitigations are load-bearing rather than tidy: the account
 * control and the Preferences section carry stable icons, and these options are
 * **endonyms** — `Latviešu`, not `Latvian` — so the destination is legible from
 * any starting language. That is also why this set is the one with no icons: it
 * is already self-naming, and a flag beside a language is a nationality beside
 * a language.
 *
 * **The options are the contracts tuple**, not a list written here: `LOCALES`
 * is declared once and consumed by `pgEnum`, by the `PATCH /settings` body and
 * by this group (ADR-0023), so a locale appended later cannot leave a control
 * behind.
 *
 * `rows` rather than the appearance control's `cards` (ADR-0054 §7): a language
 * list is read as a list. Both layouts are the same 44px rung.
 */

/**
 * One key per locale, `Record<Locale, …>` so the contracts tuple still cannot
 * leave a control behind — `THEME_LABEL_KEYS`' argument, one enum along.
 *
 * These two entries are the same in every catalogue, which is a translator
 * asked one fewer pointless question.
 */
const LOCALE_LABEL_KEYS: Record<Locale, TranslationKey> = {
  en: "settings:language.en",
  lv: "settings:language.lv",
};

export const LocaleRows = () => {
  /*
   * `settings`, for the reason `ThemeCards` gives: the appearance control, the
   * density mode and this one are three views of a single account settings row,
   * so their copy is catalogued together (ADR-0046 §3).
   */
  const { t } = useT("settings");
  const tk = useKeyT();
  const { locale, setLocale } = useLocale();

  return (
    <SettingsOptions
      label={t("language.title")}
      layout="rows"
      name="locale"
      onChange={setLocale}
      options={LOCALES.map((option) => ({
        value: option,
        label: tk(LOCALE_LABEL_KEYS[option]),
      }))}
      value={locale}
    />
  );
};
