import { LOCALES, type Locale } from "@repo/contracts";

import { useKeyT, useLocale, useT, type TranslationKey } from "@/shared/i18n";
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/shared/ui";

/**
 * Choosing the language the panel speaks (ADR-0046 §4, `D7.5`).
 *
 * The theme's sibling in every respect that matters, and built as its twin on
 * purpose: a set of menu *items* rather than a menu, so the account dropdown in
 * the sidebar footer stays a composition and this slice holds no opinion about
 * where it hangs. An operator looking for "a preference about me" finds both in
 * the same place, which is the whole argument `D6.3` made for putting the theme
 * there.
 *
 * **The options are the contracts tuple**, not a list written here: `LOCALES`
 * is declared once and consumed by `pgEnum`, by the `PATCH /settings` body and
 * by this radio group (ADR-0023), so the locale `D7.1` appended could not leave
 * a control behind — and the next one cannot either.
 *
 * The write is one call and it goes two places, which `useLocale` owns: the
 * running instance and the device cache immediately, the account row through
 * the publisher `app/providers` installs. **This component cannot tell whether
 * there is an account**, which is what keeps it identical on a screen that has
 * no session to write to.
 */

/**
 * One key per locale, `Record<Locale, …>` so the contracts tuple still cannot
 * leave a control behind — `THEME_LABEL_KEYS`' argument, one enum along.
 *
 * **The names are endonyms**: `Latviešu`, not `Latvian`. A language menu is the
 * one list an operator reads in a language they may not have chosen yet — the
 * whole reason they are opening it is that the current one is wrong — so
 * naming each language in itself is what makes the menu usable from inside the
 * wrong locale. It also means these two entries are the same in every
 * catalogue, which is a translator asked one fewer pointless question.
 */
const LOCALE_LABEL_KEYS: Record<Locale, TranslationKey> = {
  en: "settings:language.en",
  lv: "settings:language.lv",
};

export const LocaleMenuItems = () => {
  /*
   * `settings`, for the reason `ThemeMenuItems` gives: the appearance control
   * and this one are two views of a single account settings row, so their copy
   * is catalogued together (ADR-0046 §3).
   */
  const { t } = useT("settings");
  const tk = useKeyT();
  const { locale, setLocale } = useLocale();

  return (
    <>
      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
        {t("language.label")}
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup
        onValueChange={(value) => {
          /*
           * Radix hands back a `string`; the narrowing is what stops a future
           * option existing in the DOM and not in the contract. An unknown
           * value is dropped rather than sent, because the API would refuse it
           * and the refusal would be a toast about a control this app drew.
           */
          const next = LOCALES.find((candidate) => candidate === value);

          if (next !== undefined) setLocale(next);
        }}
        value={locale}
      >
        {LOCALES.map((option) => (
          <DropdownMenuRadioItem key={option} value={option}>
            {tk(LOCALE_LABEL_KEYS[option])}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
};
