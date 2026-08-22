import type { Locale } from "@repo/contracts";

import { asLocale } from "./resolve-locale";

/**
 * The locale's device cache (ADR-0046 §4, ADR-0033 §D3.1).
 *
 * The same shape and the same reasoning as `shared/theme`'s stored theme, and
 * for the same reason it exists at all: before the session bootstrap settles
 * there is nobody to ask, and a login screen in the wrong language is the
 * defect the cache prevents. It holds a language name and nothing else — no
 * token, no principal, no identifier — which is what keeps it inside the
 * carve-out rather than beside the credentials the carve-out exists to
 * protect.
 *
 * Both functions are guarded, like ADR-0041's adapter: `localStorage` throws
 * on quota and is absent or poisoned in some private modes, and a display
 * preference that cannot be read must degrade to the default rather than to a
 * blank app.
 */

/** Unchanged across D7, so a locale chosen in `D7.5` survives every later step. */
export const LOCALE_STORAGE_KEY = "machxi.admin.locale";

export const readStoredLocale = (): Locale | null => {
  try {
    return asLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return null;
  }
};

export const writeStoredLocale = (locale: Locale): void => {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* not persisting is an acceptable outcome; an unreadable app is not */
  }
};
