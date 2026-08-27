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
  LOCALE_STORAGE_KEY,
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
  preferredLocale,
  readStoredLocale,
  resolveInitialLocale,
  setIntlLocale,
  useLocale,
  useKeyT,
  usePseudoNotice,
  writeStoredLocale,
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
 * The zod installer stayed in this app because its `RULE_KEYS` name keys in
 * the app's own `form` namespace (`D9.2`, ADR-0046 §13).
 */
export {
  RULE_KEYS,
  applyZodLocale,
  createRuleTranslator,
  zodLocaleReady,
  type RuleTranslator,
} from "./zod-locale";

/**
 * The hook, under the name the rest of the app uses. Re-exported here so a
 * slice imports one module for its keys and its translator, and so the day the
 * library changes there is one import to rewrite (ADR-0046 §13).
 */
export { useT } from "@repo/i18n";
