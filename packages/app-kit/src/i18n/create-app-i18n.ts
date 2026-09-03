import {
  createI18n as createI18nBase,
  type Catalogues,
  type CreateI18nOptions,
  type I18n,
} from "@repo/i18n";
import type { ResourceKey } from "i18next";

/**
 * The app i18n factory (ADR-0046 §13), extracted at `D14.8` (ADR-0062 §1).
 *
 * `@repo/i18n`'s `createI18n` is the machinery; this is the **composition
 * around it** that both apps had written out identically: compose the
 * catalogues the rendering packages ship into the app's own, and dispatch a
 * lazy namespace load to whichever of the two owns it.
 *
 * **Two things stay in the app and arrive as parameters.** The package
 * registry, because which packages an app renders is the app's fact — the
 * admin composes `@repo/grid` and `@repo/form`, the customer `@repo/form`
 * alone (ADR-0055 §3). And the app catalogue loader, because a dynamic
 * `import()` of `./locales/<language>/<namespace>.json` is resolved by the
 * bundler **relative to the file it is written in**: moved here it would glob
 * this package's directory, which holds no catalogues at all. It is one of the
 * few expressions in this repository that genuinely cannot travel.
 */
export interface PackageCatalogue {
  /** The eager bundles, by locale — merged into `resources` at `init`. */
  readonly bundles: Readonly<Record<string, object>>;
  /** The lazy loader for a locale the app did not bundle eagerly. */
  readonly loadCatalogue: (language: string) => Promise<object>;
}

export interface AppI18nDeps {
  /** ADR-0064 §1's device-key prefix, bound by the app's `shared/config`. */
  readonly storageKeyPrefix: string;
  /** The namespace an unprefixed key resolves in (ADR-0046 §3). */
  readonly defaultNamespace: string;
  /** The rendering packages this app composes, by namespace name. */
  readonly packages: Readonly<Record<string, PackageCatalogue>>;
  /** `import("./locales/<language>/<namespace>.json")`, from the app. */
  readonly loadAppCatalogue: (
    language: string,
    namespace: string,
  ) => Promise<ResourceKey>;
  /** ADR-0046 §13's two seams — the zod installer and its readiness gate. */
  readonly onLocaleApplied?: CreateI18nOptions["onLocaleApplied"];
  readonly localeSideEffectsReady?: CreateI18nOptions["localeSideEffectsReady"];
}

/** What a consuming app still decides per instance. */
export type AppI18nOptions = Omit<
  CreateI18nOptions,
  "storageKeyPrefix" | "defaultNamespace" | "loadCatalogue"
>;

export const createAppI18nFactory = ({
  storageKeyPrefix,
  defaultNamespace,
  packages,
  loadAppCatalogue,
  onLocaleApplied,
  localeSideEffectsReady,
}: AppI18nDeps): ((options: AppI18nOptions) => I18n) => {
  const loadCatalogue = async (
    language: string,
    namespace: string,
  ): Promise<ResourceKey> => {
    const pkg = packages[namespace];

    if (pkg) return (await pkg.loadCatalogue(language)) as ResourceKey;

    return loadAppCatalogue(language, namespace);
  };

  /*
   * `structuredClone` per locale, because i18next mutates the resource store
   * it is initialised with — a package's exported bundle is a module-level
   * object shared by every instance in the process, and a suite that mounts
   * two apps would otherwise have the first one's post-processing leak into
   * the second's.
   */
  const withPackageBundles = (resources: Catalogues): Catalogues => {
    const composed: Record<string, Record<string, object>> = {};

    for (const [locale, catalogue] of Object.entries(resources)) {
      composed[locale] = { ...catalogue };
    }

    for (const [namespace, pkg] of Object.entries(packages)) {
      for (const [locale, bundle] of Object.entries(pkg.bundles)) {
        composed[locale] = {
          ...composed[locale],
          [namespace]: structuredClone(bundle),
        };
      }
    }

    return composed as Catalogues;
  };

  /*
   * The two optional seams are spread in only when present, rather than passed
   * as `undefined`: `exactOptionalPropertyTypes` makes those two different
   * things, and an explicit `undefined` is not an omission.
   */
  return (options: AppI18nOptions): I18n =>
    createI18nBase({
      storageKeyPrefix,
      defaultNamespace,
      loadCatalogue,
      ...(onLocaleApplied ? { onLocaleApplied } : {}),
      ...(localeSideEffectsReady ? { localeSideEffectsReady } : {}),
      ...options,
      resources: withPackageBundles(options.resources),
    });
};
