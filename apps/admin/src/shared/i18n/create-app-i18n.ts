import type { ResourceKey } from "i18next";

import {
  createI18n as createI18nBase,
  type CreateI18nOptions,
  type I18n,
} from "@repo/i18n";

import { DEFAULT_NAMESPACE, type Namespace } from "./namespaces";
import type { Catalogues } from "./resources";
import {
  applyZodLocale,
  createRuleTranslator,
  zodLocaleReady,
} from "./zod-locale";

/**
 * This app's instance factory: `@repo/i18n`'s, with the three things only this
 * app can supply already bound (`D9.2`, ADR-0051).
 *
 * **The door supplies app config, and this is what that means concretely.**
 * The package's `createI18n` takes a `defaultNamespace` and two locale-change
 * seams because it cannot know an app's namespace names and must not name a
 * key it does not own (ADR-0046 §13). All three are this app's answers, and
 * binding them here rather than at each call site is what keeps `createI18n`
 * meaning the same thing everywhere in the app — the composition root, the
 * eleven suites that build an instance, and anything added later.
 *
 * The seams carry ADR-0046 §6's rule: the field messages an operator reads are
 * zod's own, so a locale that moved the headers and left `Too small: expected
 * string to have >=12 characters` under the password box would have localised
 * everything except the sentence the operator is being asked to act on.
 * `applyZodLocale` is fire-and-forget because `lv`'s map is a chunk and nothing
 * on that tick waits for a validation message; `zodLocaleReady` is what lets a
 * caller that *does* care treat "the locale changed" as one settled event.
 *
 * Every field stays overridable — the spread is last — so a test that wants a
 * bare instance can still ask for one.
 */
/**
 * Where this app's non-eager catalogues come from.
 *
 * The specifier is relative to **this** module, which is the whole reason it
 * lives here: `@repo/i18n` used to own an identical function, and a relative
 * `import()` resolves against the module that writes it, so the day the
 * factory moved the path pointed at a package with no `locales/` — an `lv`
 * that silently never loaded. Caught by the plural suite, which asserts
 * Latvian's three forms.
 */
const loadCatalogue = async (
  language: string,
  namespace: string,
): Promise<ResourceKey> => {
  const catalogue: unknown = await import(
    `./locales/${language}/${namespace}.json`
  );

  return catalogue as ResourceKey;
};

/**
 * This app's options: the package's, with the two fields it had to widen
 * narrowed back (`D9.2`).
 *
 * `@repo/i18n` types `resources` and `namespaces` as `string`-keyed shapes
 * because a package cannot know an app's namespace names. That widening is
 * correct there and would be a real loss here: **the `namespaces` parameter is
 * the only thing enforcing that every name in `NAMESPACES` has an eager `en`
 * catalogue**, because `EN_RESOURCES` is `as const` and is never annotated.
 * Left wide, `namespaces: ["bogus"]` would type-check at the composition root.
 * So the wrapper that binds this app's config narrows its types in the same
 * motion — which is the door's job in both directions.
 */
export type CreateAppI18nOptions = Omit<
  CreateI18nOptions,
  "namespaces" | "resources"
> & {
  readonly resources: Catalogues;
  readonly namespaces: readonly Namespace[];
};

export const createI18n = (options: CreateAppI18nOptions): I18n =>
  createI18nBase({
    defaultNamespace: DEFAULT_NAMESPACE,
    loadCatalogue,
    onLocaleApplied: (locale, translate) => {
      applyZodLocale(locale, createRuleTranslator(translate));
    },
    localeSideEffectsReady: zodLocaleReady,
    ...options,
  });
