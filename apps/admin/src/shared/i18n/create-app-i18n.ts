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
  GRID_NAMESPACE,
  bundles as gridBundles,
  loadCatalogue as loadGridCatalogue,
} from "@repo/grid";

import {
  createI18n as createI18nBase,
  type CreateI18nOptions,
  type I18n,
} from "@repo/i18n";

import { DEVICE_KEY_PREFIX } from "@/shared/config";

import { DEFAULT_NAMESPACE, type Namespace } from "./namespaces";
import type { Catalogues, PackageNamespace } from "./resources";

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
  /*
   * **A package's namespace is fetched from the package, not from here**
   * (`D9.4`). `grid` is still in `NAMESPACES` — `init` must load it — but its
   * catalogues live in `@repo/grid`, whose `en` is composed in at `init` and
   * whose other locales are its own chunks (ADR-0046 §3). Without this branch
   * i18next asks *this* app's loader for a namespace it has no file for, the
   * dynamic import rejects, and the namespace is left half-loaded: the copy
   * resolves, but react-i18next keeps re-rendering every component bound to
   * it, which is enough to lose a grid's ephemeral selection between a click
   * and its assertion. Found by the grid's own suite at `D9.4`.
   */
  const pkg = PACKAGE_BUNDLES[namespace as PackageNamespace];

  if (pkg) return (await pkg.loadCatalogue(language)) as ResourceKey;

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
  "namespaces" | "resources" | "storageKeyPrefix"
> & {
  readonly resources: Catalogues;
  readonly namespaces: readonly Namespace[];
};

/**
 * The packages whose namespaces this app composes in (`D9.4`, ADR-0046 §13).
 *
 * **§13's rule, run for the first time on real strings**: a package that ships
 * operator-facing copy declares its own namespace and exports a `register`;
 * the app calls each one on the instance it just built. `@repo/grid` is the
 * first — `grid.json` used to be one of this app's ten catalogues and is the
 * package's now — and `@repo/form` joined it at `D9.5`,
 * bringing the zod installer with it: `RULE_KEYS` name keys in the `form`
 * namespace, so the two seams this factory binds are imported from the package
 * that owns the sentences they resolve.
 *
 * The name stays in `NAMESPACES` even though the catalogue does not live here
 * any more, because `init` must still load it; what moved is who owns the
 * words, not which namespaces the instance has.
 */
/**
 * What each package contributes: its source-locale catalogue, composed at
 * `init`, and a loader for every other locale (`D9.4`, ADR-0046 §3).
 *
 * Keyed by {@link PackageNamespace} rather than by `string`, so this list and
 * the type in `./resources` check each other: adding a name to one without the
 * other is a compile error rather than a namespace that silently resolves to
 * nothing.
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
  [GRID_NAMESPACE]: {
    bundles: gridBundles,
    loadCatalogue: loadGridCatalogue,
  },
  [FORM_NAMESPACE]: {
    bundles: formBundles,
    loadCatalogue: loadFormCatalogue,
  },
};

/**
 * Folds every package's catalogues into the app's own, per locale.
 *
 * **Composed at `init` rather than registered after it**, which is the half of
 * ADR-0046 §13 this app takes: §13 says each app composes its own bundle, and
 * doing it here means the instance is complete the moment it exists. The
 * alternative — `addResourceBundle` on the live instance — makes i18next emit,
 * and react-i18next re-renders every bound component when it does; during an
 * asynchronous gesture that re-render lands between a click and its assertion
 * and can discard what the click had just set. The grid's own suite found
 * that at `D9.4`.
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
       * package's module-level JSON would let one instance's merges reach
       * every instance built afterwards — the cross-instance leak `D9.2` fixed
       * for this app's own catalogues, in the shape a package's introduce.
       */
      composed[locale] = {
        ...composed[locale],
        [namespace]: structuredClone(bundle),
      };
    }
  }

  return composed as Catalogues;
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
