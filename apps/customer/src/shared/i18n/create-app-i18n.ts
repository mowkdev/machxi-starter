import type { ResourceKey } from "i18next";

import {
  FORM_NAMESPACE,
  applyZodLocale,
  bundles as formBundles,
  createRuleTranslator,
  loadCatalogue as loadFormCatalogue,
  zodLocaleReady,
} from "@repo/form";

import {
  createI18n as createI18nBase,
  type CreateI18nOptions,
  type I18n,
} from "@repo/i18n";

import { DEVICE_KEY_PREFIX } from "@/shared/config";

import { DEFAULT_NAMESPACE, type Namespace } from "./namespaces";
import type { Catalogues, PackageNamespace } from "./resources";

/**
 * This app's instance factory: `@repo/i18n`'s, with the things only this app
 * can supply already bound (ADR-0051's door rule, ADR-0046 §13).
 *
 * **The door supplies app config**, and here that is two answers: what an
 * unprefixed key means, and where a non-eager catalogue comes from. Binding
 * them here rather than at each call site is what keeps `createI18n` meaning
 * the same thing everywhere in the app — the composition root, every suite that
 * builds an instance, and anything added later.
 *
 * **`onLocaleApplied`/`localeSideEffectsReady` are bound since `D12.6`**, and
 * their absence before it was a statement rather than an omission: a consumer
 * with no schemas on screen should not pay for the zod installer, which is
 * exactly why `@repo/i18n` made both a parameter (`D9.2`). The account area is
 * the first surface here to put a zod schema in front of a customer, so the
 * seams are wired now and carry ADR-0046 §6's rule — a locale that moved the
 * headers and left `Too small: expected string to have >=12 characters` under
 * the password box would have localised everything except the sentence the
 * person is being asked to act on. `applyZodLocale` is fire-and-forget because
 * `lv`'s map is a chunk and nothing on that tick waits for a validation
 * message; `zodLocaleReady` is what lets a caller that *does* care treat "the
 * locale changed" as one settled event.
 *
 * Every field stays overridable — the spread is last — so a test that wants a
 * bare instance can still ask for one. `resources` is the one exception and
 * comes after it, because what the caller hands in is the app's half and the
 * packages' half is folded on top; a caller that could suppress that would be
 * able to build an instance whose `form` namespace resolves to nothing.
 */

/**
 * Where this app's non-eager catalogues come from.
 *
 * The specifier is relative to **this** module, which is the whole reason it
 * lives here rather than in the package: `@repo/i18n` used to own an identical
 * function, and a relative `import()` resolves against the module that writes
 * it, so the day the factory moved the path pointed at a package with no
 * `locales/` — an `lv` that silently never loaded (`D9.2`).
 */
const loadCatalogue = async (
  language: string,
  namespace: string,
): Promise<ResourceKey> => {
  /*
   * **A package's namespace is fetched from the package, not from here**
   * (`D12.6`, the admin's `D9.4`). `form` is in `NAMESPACES` — `init` must load
   * it — but its catalogues live in `@repo/form`, whose `en` is composed in at
   * `init` and whose other locales are its own chunks (ADR-0046 §3). Without
   * this branch i18next asks *this* app's loader for a namespace it has no file
   * for, the dynamic import rejects, and the namespace is left half-loaded: the
   * copy resolves, but react-i18next keeps re-rendering every component bound to
   * it — enough, in the admin's grid, to lose an ephemeral selection between a
   * click and its assertion.
   */
  const pkg = PACKAGE_BUNDLES[namespace as PackageNamespace];

  if (pkg) return (await pkg.loadCatalogue(language)) as ResourceKey;

  const catalogue: unknown = await import(
    `./locales/${language}/${namespace}.json`
  );

  return catalogue as ResourceKey;
};

/**
 * What each package contributes: its source-locale catalogue, composed at
 * `init`, and a loader for every other locale (ADR-0046 §3, §13).
 *
 * Keyed by {@link PackageNamespace} rather than by `string`, so this list and
 * the type in `./resources` check each other: adding a name to one without the
 * other is a compile error rather than a namespace that silently resolves to
 * nothing.
 *
 * One entry, where the admin has two — `@repo/grid` is not a dependency of this
 * app (ADR-0055 §3).
 */
const PACKAGE_BUNDLES: Readonly<
  Record<
    PackageNamespace,
    {
      readonly bundles: Readonly<Record<string, object>>;
      readonly loadCatalogue: (language: string) => Promise<object>;
    }
  >
> = {
  [FORM_NAMESPACE]: {
    bundles: formBundles,
    loadCatalogue: loadFormCatalogue,
  },
};

/**
 * Folds every package's catalogues into the app's own, per locale.
 *
 * **Composed at `init` rather than registered after it**, which is the half of
 * ADR-0046 §13 an app takes: §13 says each app composes its own bundle, and
 * doing it here means the instance is complete the moment it exists. The
 * alternative — `addResourceBundle` on the live instance — makes i18next emit,
 * and react-i18next re-renders every bound component when it does; during an
 * asynchronous gesture that re-render lands between a click and its assertion.
 */
const withPackageBundles = (resources: Catalogues): Catalogues => {
  const composed: Record<string, Record<string, object>> = {};

  for (const [locale, catalogue] of Object.entries(resources)) {
    composed[locale] = { ...catalogue };
  }

  for (const [namespace, pkg] of Object.entries(PACKAGE_BUNDLES)) {
    for (const [locale, bundle] of Object.entries(pkg.bundles)) {
      /*
       * A deep copy of the package's bundle, not a reference to it. i18next
       * holds what `init` is handed and merges into it, so handing over the
       * package's module-level JSON would let one instance's merges reach every
       * instance built afterwards — a cross-instance leak in a suite that
       * builds one per render.
       */
      composed[locale] = {
        ...composed[locale],
        [namespace]: structuredClone(bundle),
      };
    }
  }

  return composed as Catalogues;
};

/**
 * This app's options: the package's, with the two fields it had to widen
 * narrowed back.
 *
 * `@repo/i18n` types `resources` and `namespaces` as `string`-keyed shapes
 * because a package cannot know an app's namespace names. That widening is
 * correct there and would be a real loss here: **the `namespaces` parameter is
 * the only thing enforcing that every name in `NAMESPACES` has an eager `en`
 * catalogue**, because `EN_RESOURCES` is `as const` and is never annotated.
 * Left wide, `namespaces: ["bogus"]` would type-check at the composition root.
 */
export type CreateAppI18nOptions = Omit<
  CreateI18nOptions,
  "namespaces" | "resources" | "storageKeyPrefix"
> & {
  readonly resources: Catalogues;
  readonly namespaces: readonly Namespace[];
};

export const createI18n = (options: CreateAppI18nOptions): I18n =>
  createI18nBase({
    // This app's device-key prefix (ADR-0064 §1): the package writes one key
    // and may not know whose it is.
    storageKeyPrefix: DEVICE_KEY_PREFIX,
    defaultNamespace: DEFAULT_NAMESPACE,
    loadCatalogue,
    onLocaleApplied: (locale, translate) => {
      applyZodLocale(locale, createRuleTranslator(translate));
    },
    localeSideEffectsReady: zodLocaleReady,
    ...options,
    resources: withPackageBundles(options.resources),
  });
