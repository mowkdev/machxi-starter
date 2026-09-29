import { LOCALES, type Locale } from "@repo/contracts";
import { useKeyT, useLocale, useT, type TranslationKey } from "@repo/i18n";

import type { PreferenceOptionsControl } from "./options-control";

/**
 * Choosing the language the app speaks (ADR-0046 §4; the surface is ADR-0053
 * §2's) — one control for both apps since `D22.2` (ADR-0077 §2).
 *
 * `useLocale` owns both halves — the running instance and the device cache
 * immediately, the account row through the publisher the settings gate
 * installs — and this component cannot tell whether there is an account.
 *
 * **ADR-0046 §4's escape hatch is what pays for the control living on a
 * page.** A person stranded in a language they cannot read is two clicks and
 * a section label away from the way out, and a customer in that position has
 * nobody to ask. The mitigations are the record's: the account entry and the
 * preferences section carry stable icons, and these options are **endonyms**
 * — `Latviešu`, not `Latvian` — so the destination is legible from any
 * starting language. That is also why this set is the one with no icons: it
 * is already self-naming, and a flag beside a language is a nationality
 * beside a language.
 *
 * **The options are the contracts tuple**, not a list written here: `LOCALES`
 * is declared once and consumed by `pgEnum`, by the `PATCH /settings` body and
 * by this group (ADR-0023), so a locale appended later cannot leave a control
 * behind.
 *
 * `rows` rather than the appearance control's `cards` (ADR-0054 §7 as amended
 * at `D11.10`): a language list is read as a list. Both layouts are the same
 * 44px rung.
 */

/**
 * One key per locale, `Record<Locale, …>` so the contracts tuple still cannot
 * leave a control behind — `THEME_LABEL_KEYS`' argument, one enum along.
 *
 * These two entries are the same in every catalogue, which is a translator
 * asked one fewer pointless question.
 */
const LOCALE_LABEL_KEYS: Record<Locale, TranslationKey> = {
  en: "accountClient:preferences.language.en",
  lv: "accountClient:preferences.language.lv",
};

export const createLocaleRows = (Options: PreferenceOptionsControl) => {
  const LocaleRows = () => {
    const { t } = useT("accountClient");
    const tk = useKeyT();
    const { locale, setLocale } = useLocale();

    return (
      <Options
        label={t("preferences.language.title")}
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

  return LocaleRows;
};
