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
 * (`D9.2`, ADR-0051).
 *
 * The machinery moved; every import path in the app did not — a slice still
 * writes `from "@/shared/i18n"` for its keys and its translator, which is what
 * ADR-0046 §13 asked for and what ADR-0051 generalises into the door rule. The
 * `no-restricted-imports` group keeps `@repo/i18n` out of every layer above.
 *
 * **What this app owns and re-exports from beside the door**: the ten
 * namespaces, the `en` catalogues they are cut into, the `CustomTypeOptions`
 * augmentation in `types.d.ts` that makes `TranslationKey` real, and the two
 * bindings in `./keys` that read them. Those are the dictionary, and a
 * dictionary belongs to an app.
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
  useLocale,
  useKeyT,
  usePseudoNotice,
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
 * namespace and the two locale-change seams the package leaves open (`D9.2`).
 */
export { createI18n, type CreateAppI18nOptions } from "./create-app-i18n";
export { DEFAULT_NAMESPACE, NAMESPACES, type Namespace } from "./namespaces";
/*
 * The app's own `Catalogue`/`Catalogues`, which are narrower than the
 * package's: they are keyed by this app's ten-name `Namespace` union, where
 * the package can only require `Record<string, object>`. The narrow pair is
 * what belongs in the app, so the door takes them from here rather than from
 * `@repo/i18n` — a package cannot check a list it does not have.
 */
export { EN_RESOURCES, type Catalogue, type Catalogues } from "./resources";
export { createDeferredTranslate, englishTranslation } from "./keys";
/*
 * The zod installer left at `D9.5`, following the `form` namespace whose keys
 * its `RULE_KEYS` name: it is `@repo/form`'s now and comes through that
 * slice's door, `@/shared/form/zod-locale` (`D9.2` found the coupling,
 * ADR-0046 §13).
 */
/**
 * The hook, under the name the rest of the app uses. Re-exported here so a
 * slice imports one module for its keys and its translator, and so the day the
 * library changes there is one import to rewrite (ADR-0046 §13).
 */
export { useT } from "@repo/i18n";

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
