import { DEFAULT_LOCALE, type Locale } from "@repo/contracts";

import { INTL_TAGS } from "./tags";

/**
 * Every `Intl` object the app builds, behind the active locale (ADR-0046 §5,
 * `D7.2`).
 *
 * Before this, `shared/grid/formatters.ts` and `filter-chips.ts` each built
 * their `Intl.DateTimeFormat` with `undefined` as the locale — which does not
 * mean "the app's locale", it means **the browser's**. A Latvian operator on an
 * English OS would have read Latvian column headers over English dates, and an
 * English operator on a German OS would have read `12.08.2026` under headers
 * that say "Created". The formatters follow the copy from here on.
 *
 * **A module-level holder, swapped by `createI18n`'s `languageChanged`
 * listener**, which is what ADR-0046 §5 asks for by name: the alternative is
 * threading a locale into every `Formatter`, and ADR-0035 fixes a registry
 * entry's shape as `(value) => string`. So the entries stay pure functions of a
 * value and the *tag they read* is what moves.
 *
 * The consequence to know: this is app-wide, not per-instance. Two i18next
 * instances at two locales in one test file share it and the last
 * `languageChanged` wins. That is tolerable because `en` is the suite's locale
 * (ADR-0046 §14) and a test that switches deliberately is asserting about the
 * switch — but it is the reason a locale-sensitive assertion belongs in a file
 * that renders one tree.
 *
 * Formatters are cached per tag and options, because `Intl.DateTimeFormat` is
 * expensive to construct and a grid builds one per cell otherwise.
 */

let activeTag: string = INTL_TAGS[DEFAULT_LOCALE];

const cache = new Map<string, Intl.DateTimeFormat>();

/**
 * Called by the `languageChanged` listener, before React re-renders.
 *
 * The order matters and is not incidental: `createI18n` subscribes this
 * listener *before* `initReactI18next`, so the tag has already moved by the
 * time react-i18next tells the tree to render, and a grid's dates change in the
 * same paint as its headers rather than one behind.
 */
export const setIntlLocale = (locale: Locale): void => {
  if (INTL_TAGS[locale] === activeTag) return;

  activeTag = INTL_TAGS[locale];
  cache.clear();
};

/** The tag every `Intl` object in this app is built with. */
export const activeIntlTag = (): string => activeTag;

/**
 * An `Intl.DateTimeFormat` in the active locale.
 *
 * `options` is required to be a stable, module-level object at every call site
 * — the cache key is derived from it, and building the object inline would key
 * on an equal-but-new string every render, which still works and defeats the
 * cache.
 */
export const dateTimeFormat = (
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat => {
  const key = `${activeTag}|${JSON.stringify(options)}`;
  const hit = cache.get(key);

  if (hit !== undefined) return hit;

  const built = new Intl.DateTimeFormat(activeTag, options);

  cache.set(key, built);

  return built;
};
