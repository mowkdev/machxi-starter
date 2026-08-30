import { LOCALES, type Locale } from "@repo/contracts";

import { useKeyT, useLocale, useT, type TranslationKey } from "@/shared/i18n";
import { SettingsOptions } from "@/shared/ui";

/**
 * Choosing the language the panel speaks (ADR-0046 §4; the surface is
 * ADR-0053 §2's).
 *
 * **This was `LocaleMenuItems` until `D11.10`**, and it moved for the same
 * reason and on the same terms as its appearance twin: the account menu is not
 * a settings surface, `/account/preferences` is the one inventory, and the
 * write path is untouched. `useLocale` still owns both halves — the running
 * instance and the device cache immediately, the account row through the
 * publisher `app/providers` installs — and this component still cannot tell
 * whether there is an account.
 *
 * **The move has a known cost and ADR-0046 §4's escape hatch is what pays it.**
 * An operator stranded in a language they cannot read used to be one menu away
 * from the way out and is now two clicks and a section label away. The
 * mitigations are the record's: the account entry and the preferences section
 * carry stable icons, and these options are **endonyms** — `Latviešu`, not
 * `Latvian` — so the destination is legible from any starting language. That
 * is also why this set is the one with no icons: it is already self-naming,
 * and a flag beside a language is a nationality beside a language.
 *
 * **The options are the contracts tuple**, not a list written here: `LOCALES`
 * is declared once and consumed by `pgEnum`, by the `PATCH /settings` body and
 * by this group (ADR-0023), so the locale `D7.1` appended could not leave a
 * control behind — and the next one cannot either.
 *
 * `rows` rather than the appearance control's `cards`, which is the plan's own
 * division and ADR-0054 §7 as amended at `D11.10`: a language list is read as
 * a list. Both layouts are the same 44px rung.
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
   * density mode and this one are three views of a single account settings
   * row, so their copy is catalogued together (ADR-0046 §3).
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
