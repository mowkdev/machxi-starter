import {
  CUSTOM_MESSAGES,
  type CustomMessageKey,
  type Locale,
  createCustomMessageError,
} from "@repo/contracts";
import { z } from "zod";
import enZodLocale from "zod/v4/locales/en.js";

import type { TranslateKey, TranslationKey } from "@repo/i18n";

/**
 * Validation copy, in the operator's language (ADR-0046 §6, `D7.5`).
 *
 * This is the half of the sweep that never appears in a `t()` call, and the
 * `D3.9` argument in `shared/form/server-errors.ts` named the mechanism years
 * of deliverables ago: *"localising the latter is zod's own error map on the
 * contracts package"*. This module is that sentence, executed.
 *
 * Two maps are installed, and they answer two different kinds of rule:
 *
 * - **`localeError`** answers the generic issues — `too_small`,
 *   `invalid_format`, `invalid_type` — which is nearly every field rule this
 *   app renders. zod 4 ships `en`; `lv` is ours, lives in `@repo/contracts`
 *   behind a subpath, and arrives through a dynamic `import()` so an English
 *   operator never downloads it.
 * - **`customError`** answers the handful of `.refine()`s that carry a sentence
 *   somebody wrote. `@repo/contracts` installs a source-language map for them
 *   on import, which is what keeps the API's copy exactly what it was; this
 *   replaces it with one that asks the `form` namespace first.
 *
 * **The config is global, because zod's is.** `z.config` writes to one object
 * per process, so this module is app-wide state in the way `intl.ts` is —
 * the same cost, named in the same place, and for the same unavoidable reason:
 * a schema is parsed by `zodResolver` deep inside react-hook-form, and there is
 * no parameter an instance could arrive through. Two instances at two locales
 * in one test file share it and the last `languageChanged` wins.
 */

/**
 * Where a keyed rule's sentence lives in this app's catalogues.
 *
 * `Record<CustomMessageKey, TranslationKey>` is the completeness check and the
 * spelling check at once: a key added to `@repo/contracts` is a red build here
 * until somebody writes the sentence, and a mistyped catalogue path is a red
 * build for the reason every `TranslationKey` is. It is the same instrument
 * `__checks__/errors.ts` uses for `ErrorCode`, except that this one has a
 * runtime job as well, so it earns its place in the bundle.
 */
export const RULE_KEYS: Record<CustomMessageKey, TranslationKey> = {
  rolesUnique: "form:rules.rolesUnique",
  updateNotEmpty: "form:rules.updateNotEmpty",
  passwordMustDiffer: "form:rules.passwordMustDiffer",
};

/** What `createCustomMessageError` asks of a client that has a catalogue. */
export type RuleTranslator = (key: CustomMessageKey) => string | undefined;

/**
 * The app's answer for a keyed rule, with the source sentence as its floor.
 *
 * `defaultValue` is `CUSTOM_MESSAGES[key]` rather than the key, so a catalogue
 * that lags a contracts change renders the English rule an operator could act
 * on instead of `form:rules.somethingNew`. The contracts map has the same floor
 * behind this one; two floors is one more than necessary and exactly the right
 * number when the alternative on screen is a raw key.
 */
export const createRuleTranslator =
  (t: TranslateKey): RuleTranslator =>
  (key) =>
    t(RULE_KEYS[key], { defaultValue: CUSTOM_MESSAGES[key] });

type ZodLocaleFactory = () => { localeError: z.core.$ZodErrorMap };

/**
 * One dynamic `import()` per locale, exactly as the catalogues load (§3).
 *
 * `en` is eager because it is the fallback and the language the suite runs in;
 * `lv` is a chunk that costs the operator who chose Latvian and nobody else.
 * A locale whose module fails to arrive degrades to the English map rather than
 * to no map at all — the same degradation a missing catalogue key already has,
 * and the alternative is zod answering `"Invalid input"` for everything.
 */
const LOCALE_MAPS: Record<Locale, () => Promise<ZodLocaleFactory>> = {
  en: () => Promise.resolve(enZodLocale),
  lv: () =>
    import("@repo/contracts/locales/lv").then((module) => module.default),
};

let ready: Promise<void> = Promise.resolve();

/**
 * Installs both maps for a locale. Called by `createI18n` at construction and
 * again from its `languageChanged` listener, so nothing that changes the
 * language can leave the schemas speaking the previous one.
 *
 * Fire-and-forget by design — the listener is synchronous and a form is not
 * re-validated by a language change — with {@link zodLocaleReady} for the one
 * caller that has to know: a test that switches locale and then submits.
 */
export const applyZodLocale = (
  locale: Locale,
  translate: RuleTranslator,
): void => {
  ready = LOCALE_MAPS[locale]()
    .catch(() => enZodLocale)
    .then((factory) => {
      z.config({
        customError: createCustomMessageError(translate),
        localeError: factory().localeError,
      });
    });
};

/** Resolves once the last {@link applyZodLocale} has landed. */
export const zodLocaleReady = (): Promise<void> => ready;
