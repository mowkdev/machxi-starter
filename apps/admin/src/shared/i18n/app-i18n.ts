import {
  ACCOUNT_NAMESPACE,
  bundles as accountBundles,
  loadCatalogue as loadAccountCatalogue,
} from "@repo/account";
import {
  createAppI18nFactory,
  type AppI18nOptions,
  type PackageCatalogue,
} from "@repo/app-kit";
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
import type { I18n } from "@repo/i18n";
import type { ResourceKey } from "i18next";

import { DEVICE_KEY_PREFIX } from "@/shared/config";

import { DEFAULT_NAMESPACE, type Namespace } from "./namespaces";
import type { Catalogues, PackageNamespace } from "./resources";

/**
 * This app's i18n factory: `@repo/app-kit`'s composition (ADR-0062 §1) bound
 * to the four things only this app knows.
 *
 * **The file the door rule exempts** (ADR-0046 §13). It is the one place that
 * may reach a rendering package's catalogues directly — routing them through
 * `@/shared/form/*` would make that door export copy — and it is exempted by
 * *file* rather than by slice, so nothing else in `shared/i18n` inherits the
 * reach.
 *
 * Before `D14.8` this file also held the composition: the bundle merge, the
 * `structuredClone` per locale and the load dispatch, written out identically
 * one app over. Those are the kit's now; what is left is the registry, the
 * loader, and the narrowing of the kit's options to this app's own catalogue
 * and namespace types.
 */
const PACKAGE_BUNDLES: Readonly<Record<PackageNamespace, PackageCatalogue>> = {
  [GRID_NAMESPACE]: {
    bundles: gridBundles,
    loadCatalogue: loadGridCatalogue,
  },
  [FORM_NAMESPACE]: {
    bundles: formBundles,
    loadCatalogue: loadFormCatalogue,
  },
  // `D22.2` (ADR-0077 §2): the account's client ships the copy both apps
  // wrote identically, and is composed at `init` like the two above it.
  [ACCOUNT_NAMESPACE]: {
    bundles: accountBundles,
    loadCatalogue: loadAccountCatalogue,
  },
};

/**
 * The one expression that cannot travel: Vite resolves the glob from the file
 * the `import()` is written in, so this has to live in the app whose
 * `locales/` directory it means (ADR-0062 §1).
 */
const loadAppCatalogue = async (
  language: string,
  namespace: string,
): Promise<ResourceKey> => {
  const catalogue: unknown = await import(
    `./locales/${language}/${namespace}.json`
  );

  return catalogue as ResourceKey;
};

export type CreateAppI18nOptions = Omit<
  AppI18nOptions,
  "namespaces" | "resources"
> & {
  readonly resources: Catalogues;
  readonly namespaces: readonly Namespace[];
};

const build = createAppI18nFactory({
  storageKeyPrefix: DEVICE_KEY_PREFIX,
  defaultNamespace: DEFAULT_NAMESPACE,
  packages: PACKAGE_BUNDLES,
  loadAppCatalogue,
  // ADR-0046 §13's two seams: zod's messages follow the locale, and the
  // instance waits for the installer before announcing the change.
  onLocaleApplied: (locale, translate) => {
    applyZodLocale(locale, createRuleTranslator(translate));
  },
  localeSideEffectsReady: zodLocaleReady,
});

/**
 * Narrowed deliberately: the kit takes `Catalogues` and `readonly string[]`,
 * because a package cannot know an app's namespace union — and the app's
 * composition root should still be refused a name it has no catalogue for.
 */
export const createI18n = (options: CreateAppI18nOptions): I18n =>
  build(options);
