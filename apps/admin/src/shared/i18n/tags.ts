import type { Locale } from "@repo/contracts";

/**
 * BCP 47 tags, one per locale, and the **only** place a locale becomes one
 * (ADR-0046 §5).
 *
 * It lives in `shared/i18n` rather than in `@repo/contracts` because a tag is a
 * presentation fact: the package holds the enum the database stores, and
 * `en-GB` is a decision about spelling and date order that no server makes.
 * Everything that constructs an `Intl.*` reads this map through `intl.ts`, so
 * "the browser's locale" — which is what an `undefined` argument means — is
 * never what a formatter follows.
 *
 * Its own module, and not `index.ts`, since `D7.2`: `intl.ts` needs it and
 * `index.ts` needs `intl.ts`, so leaving it in the barrel would make the two a
 * cycle. `index.ts` re-exports it, so no caller learns the difference.
 */
export const INTL_TAGS: Record<Locale, string> = {
  en: "en-GB",
  lv: "lv-LV",
};
