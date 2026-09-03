import type { Locale } from "@repo/contracts";
import {
  localeStorageKey,
  preferredLocale as preferredLocaleFor,
  readStoredLocale as readStoredLocaleFor,
  writeStoredLocale as writeStoredLocaleFor,
} from "@repo/i18n";

import { DEVICE_KEY_PREFIX } from "@/shared/config";

/**
 * The door onto `@repo/i18n`, plus the parts of the seam this app owns
 * (ADR-0051; ADR-0046 §13).
 *
 * Every slice writes `from "@/shared/i18n"` for its keys and its translator, and
 * a `no-restricted-imports` group keeps `@repo/i18n` out of every layer above.
 *
 * **What this app owns and re-exports from beside the door**: its namespaces,
 * the `en` catalogues they are cut into, the `CustomTypeOptions` augmentation
 * in `types.d.ts` that makes `TranslationKey` real, and the factory in
 * `./create-app-i18n` that binds them. Those are the dictionary, and a
 * dictionary belongs to an app — which is why this file is *not* the admin's
 * with a rename: the two apps share the machinery and share none of the words.
 *
 * Named re-exports rather than `export *`, for the reason `shared/ui` is a
 * list: the door is also the inventory, and widening it is a visible line in a
 * diff.
 */

export {
  LocalePublisherProvider,
  PSEUDO_POST_PROCESSOR,
  PseudoNoticeProvider,
  INTL_TAGS,
  activeIntlTag,
  asLocale,
  createPseudoPostProcessor,
  dateTimeFormat,
  dynamicKey,
  navigatorLocales,
  resolveInitialLocale,
  setIntlLocale,
  useKeyT,
  useLocale,
  usePseudoNotice,
  useT,
  type DeferredTranslate,
  type I18n,
  type LocalePublisher,
  type LocalePublisherProviderProps,
  type LocaleSources,
  type LocaleView,
  type PseudoNoticeProviderProps,
  type TranslateKey,
  type TranslationKey,
} from "@repo/i18n";

/*
 * `createI18n` is this app's wrapper, not the package's: it binds the default
 * namespace and the catalogue loader, whose relative specifier only this
 * module can write.
 */
export { createI18n, type CreateAppI18nOptions } from "./create-app-i18n";
/*
 * The pre-instance translator and its binder (`D12.6`). Both read this app's
 * own `en` catalogue, which is why they stayed in the app while the rest of
 * ADR-0046 §7's seam moved to the package (ADR-0046 §13).
 */
export { createDeferredTranslate, englishTranslation } from "./keys";
export { DEFAULT_NAMESPACE, NAMESPACES, type Namespace } from "./namespaces";
/*
 * The app's own `Catalogue`/`Catalogues`, which are narrower than the
 * package's: they are keyed by this app's `Namespace` union, where the package
 * can only require `Record<string, object>`. The narrow pair belongs in the
 * app, so the door takes them from here — a package cannot check a list it does
 * not have.
 */
export {
  EN_RESOURCES,
  type AppNamespace,
  type Catalogue,
  type Catalogues,
  type PackageNamespace,
} from "./resources";

/*
 * The locale's device key, bound to this app's prefix (ADR-0064 §1).
 *
 * `@repo/i18n` takes the prefix as a parameter and holds no brand; the door
 * binds it, so every slice above keeps the call it already wrote and a fork's
 * brand never reaches a package. `machxi.admin.locale` and `machxi.user.locale`
 * are what the two apps write by default — D12's finding 1, closed by the
 * mechanism rather than by a special case.
 */
export const LOCALE_STORAGE_KEY: string = localeStorageKey(DEVICE_KEY_PREFIX);

export const readStoredLocale = (): Locale | null =>
  readStoredLocaleFor(DEVICE_KEY_PREFIX);

export const writeStoredLocale = (locale: Locale): void => {
  writeStoredLocaleFor(DEVICE_KEY_PREFIX, locale);
};

export const preferredLocale = (settings: Locale | null = null): Locale =>
  preferredLocaleFor(DEVICE_KEY_PREFIX, settings);
