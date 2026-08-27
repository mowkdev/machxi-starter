import type { PostProcessorModule } from "i18next";
import Pseudo from "i18next-pseudo";

/**
 * The pseudo-locale (ADR-0046 §10) — the dev-only lens that makes a missed
 * string visible.
 *
 * `Save changes` renders as `[Šààṽḛḛ ͼḥααṇḡḛḛṡ]`: **accented** so anything still
 * in plain ASCII stands out at a glance, **widened** — the vowels are repeated —
 * so a layout that will break under a longer language breaks here first, and
 * **bracketed** so a truncation shows as a missing `]` rather than as a word
 * that happens to end early.
 *
 * It catches what a real translation cannot. A Latvian reviewer reading a screen
 * sees Latvian and does not notice the one heading nobody moved into a
 * catalogue; under this lens that heading is the only readable thing on the
 * page. §14's route suite is the executable half of the same idea.
 *
 * **It is not a locale.** `LOCALES` is the production set, it lives in a
 * database column, and an account may not be set to a lens over English. It is a
 * post-processor over `en`, switched on by `VITE_I18N_PSEUDO` at build time and
 * by the harness for the suite that walks the routes.
 */

/** The name i18next knows the post-processor by; `init` names it in `postProcess`. */
export const PSEUDO_POST_PROCESSOR = "pseudo";

/**
 * The library's constructor, wrapped (CLAUDE.md, ADR-0009): a third-party
 * `new` is called in one place and everything else takes the object.
 *
 * `languageToPseudo: "en"` is what makes this a lens rather than a language —
 * the processor passes every other language through untouched, so an instance
 * built with `pseudo: true` at `lv` shows Latvian, and switching it back to `en`
 * shows the accented source. That is the right behaviour for a lens: it reveals
 * the source language, which is the only one with anything to hide.
 */
export const createPseudoPostProcessor = (): PostProcessorModule =>
  /*
   * The one cast, and it is the library's types rather than ours.
   *
   * `i18next-pseudo` declares its own `PostProcessorModule` shape against
   * `i18next@^19`, where `process` took `key: string` and a mutable
   * `TOptions.lngs`. Both widened since, so the *implementation* satisfies
   * i18next 26 and the shipped `.d.ts` does not — under
   * `exactOptionalPropertyTypes` (ADR-0002) the two signatures cannot be
   * reconciled by anything the caller can write.
   *
   * Contained here on purpose: one expression, one file, and the only module in
   * the app that names the package. If the types are fixed upstream this line
   * is deleted and nothing else moves.
   */
  new Pseudo({
    enabled: true,
    languageToPseudo: "en",
    letterMultiplier: 2,
    wrapped: true,
  }) as unknown as PostProcessorModule;
