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

/**
 * The key one app writes its locale under, from the prefix that app supplies
 * (ADR-0064 §1).
 *
 * The prefix is `${appId}.${segment}` — `machxi.admin`, `machxi.user` — and
 * it arrives as a parameter because this package must hold no brand and no app
 * name. It also closes D12's finding 1 by construction: two SPAs on one origin
 * used to share `machxi.admin.locale`, so a customer's language followed an
 * operator's, and now each app writes under the segment it speaks to.
 *
 * `apps/admin` still writes `machxi.admin.locale`, which is what makes this a
 * seam rather than a migration.
 */
export const localeStorageKey = (keyPrefix: string): string =>
  `${keyPrefix}.locale`;

export const readStoredLocale = (keyPrefix: string): Locale | null => {
  try {
    return asLocale(window.localStorage.getItem(localeStorageKey(keyPrefix)));
  } catch {
    return null;
  }
};

export const writeStoredLocale = (keyPrefix: string, locale: Locale): void => {
  try {
    window.localStorage.setItem(localeStorageKey(keyPrefix), locale);
  } catch {
    /* not persisting is an acceptable outcome; an unreadable app is not */
  }
};
