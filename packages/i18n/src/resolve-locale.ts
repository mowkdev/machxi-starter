import { DEFAULT_LOCALE, LOCALES, type Locale } from "@repo/contracts";

/**
 * Which language the panel opens in (ADR-0046 §4).
 *
 * Pure and table-tested, because the precedence is the one part of i18n that
 * is a decision rather than a mechanism: the account's locale is the fact and
 * the device's is a cache of it, exactly as ADR-0045's first-sync rule reads
 * for a scalar. Everything impure — reading `localStorage`, reading
 * `navigator`, telling i18next — lives elsewhere and hands its answer in.
 *
 * **`Accept-Language` appears nowhere**, by either side. The API renders no
 * copy, so it has nothing to negotiate, and the one place the header would
 * have been read — a first visit with no session — is answered from
 * `navigator.languages`, which is the same data without a round trip.
 */

/**
 * A tag becomes a locale, or it does not.
 *
 * `lv-LV` matches `lv` by primary subtag, which is the whole of the matching:
 * a region narrows a language and cannot change it. Anything else is **not
 * guessed at** — `lt` is not `lv` because the strings are close, and a
 * mis-guess is worse than the English fallback, because an operator can read
 * the fallback and cannot undo a language they do not speak reaching for the
 * settings page.
 */
export const asLocale = (value: string | null | undefined): Locale | null => {
  if (!value) return null;

  const primary = value.toLowerCase().split("-")[0];

  return LOCALES.find((locale) => locale === primary) ?? null;
};

export interface LocaleSources {
  /** The principal's D6 settings row, when signed in. */
  readonly settings: Locale | null;
  /** `localStorage` `machxi.admin.locale`. */
  readonly stored: string | null;
  /** `navigator.languages`, in the browser's own order of preference. */
  readonly navigator: readonly string[];
}

/**
 * Settings → `localStorage` → `navigator.languages` → `en`.
 *
 * The second step is what stops an operator who chose Latvian reading
 * `Sign in` in English for one screen every morning: the login page has no
 * session to ask, so the device's cache is the only thing that can answer
 * before ADR-0033's bootstrap settles. It is non-credential display state,
 * which is the carve-out ADR-0033's D3.1 amendment made and the theme has
 * stood on since.
 */
export const resolveInitialLocale = ({
  settings,
  stored,
  navigator,
}: LocaleSources): Locale =>
  settings ??
  asLocale(stored) ??
  navigator.map(asLocale).find((locale) => locale !== null) ??
  DEFAULT_LOCALE;

/**
 * `navigator.languages`, defensively.
 *
 * The list is absent in some embedded browsers and empty under a few privacy
 * modes, and this runs on the path to the first paint: a throw here is the
 * whole app, for a preference that has a defined fallback.
 */
export const navigatorLocales = (): readonly string[] => {
  try {
    return window.navigator.languages ?? [window.navigator.language];
  } catch {
    return [];
  }
};
