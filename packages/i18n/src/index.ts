/**
 * The i18n machinery, extracted (`D9.2`, ADR-0051).
 *
 * Everything [ADR-0046](../../../docs/adr/0046-interface-localization.md)
 * decided about *mechanism*: the instance factory, locale negotiation and its
 * `localStorage` cache, the Intl formatters, the dev-only pseudo lens, the
 * locale control's context, and the zod-locale installer. D7 built
 * `createI18n` as a factory for exactly this day, so the move is a relocation
 * rather than a generalisation — the two app-shaped types in its options
 * (`Catalogues` over a namespace union, `readonly Namespace[]`) widened to
 * `string`-keyed shapes, and nothing else changed.
 *
 * **What deliberately did not move is every string and the list of them.** An
 * app owns its dictionary (§13): its catalogues, its namespace list, its
 * `CustomTypeOptions` augmentation, and the two bindings that read them —
 * `useKeyT` bound to the app's namespaces and `englishTranslation` walking the
 * app's bundled `en`. `TranslationKey` is named here and still resolves over
 * the app's own merge, because i18next's declaration merging is global to the
 * program.
 *
 * `register.ts` is §13's mechanism given a shape, for the string-shipping
 * packages this deliverable extracts after this one.
 */

export {
  createI18n,
  preferredLocale,
  type Catalogue,
  type Catalogues,
  type CreateI18nOptions,
  type I18n,
} from "./create-i18n";

export { activeIntlTag, dateTimeFormat, setIntlLocale } from "./intl";

export {
  createDeferredTranslate,
  createUseKeyT,
  dynamicKey,
  type DeferredTranslate,
  type TranslateKey,
} from "./keys";

export {
  LocalePublisherProvider,
  useLocale,
  type LocalePublisher,
  type LocalePublisherProviderProps,
  type LocaleView,
} from "./locale-context";

export {
  LOCALE_STORAGE_KEY,
  readStoredLocale,
  writeStoredLocale,
} from "./locale-storage";

export { PSEUDO_POST_PROCESSOR, createPseudoPostProcessor } from "./pseudo";

export {
  PseudoNoticeProvider,
  usePseudoNotice,
  type PseudoNoticeProviderProps,
} from "./pseudo-notice";

export {
  createRegister,
  type NamespaceBundles,
  type Register,
} from "./register";

export {
  asLocale,
  navigatorLocales,
  resolveInitialLocale,
  type LocaleSources,
} from "./resolve-locale";

export { INTL_TAGS } from "./tags";

export type { TranslationKey } from "./types";

/*
 * `zod-locale` is deliberately absent. Its `RULE_KEYS` name keys in the
 * consuming app's own `form` namespace, so it is app copy rather than
 * machinery and stayed in `apps/admin/src/shared/i18n` (`D9.2`, ADR-0046 §13).
 * What the factory needs from it arrives through `onLocaleApplied` and
 * `localeSideEffectsReady`. When `@repo/form` owns a namespace of its own
 * (D9.5) the installer can move there with the copy it names.
 */
