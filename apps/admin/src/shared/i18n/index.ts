import { DEFAULT_LOCALE, LOCALES, type Locale } from "@repo/contracts";
import i18next, { type Resource, type ResourceKey } from "i18next";
import resourcesToBackend from "i18next-resources-to-backend";
import { initReactI18next } from "react-i18next";

import { setIntlLocale } from "./intl";
import { readStoredLocale, writeStoredLocale } from "./locale-storage";
import type { TranslateKey } from "./keys";
import { DEFAULT_NAMESPACE, type Namespace } from "./namespaces";
import { PSEUDO_POST_PROCESSOR, createPseudoPostProcessor } from "./pseudo";
import type { Catalogues } from "./resources";
import {
  asLocale,
  navigatorLocales,
  resolveInitialLocale,
} from "./resolve-locale";
import { INTL_TAGS } from "./tags";
import {
  applyZodLocale,
  createRuleTranslator,
  zodLocaleReady,
} from "./zod-locale";

/**
 * The i18n seam (ADR-0046 §3, §5, §13). `D7.1` landed it empty; `D7.2`, `D7.3`
 * and `D7.4` filled the ten `en` catalogues it now initialises from.
 *
 * **A factory, never a module-level singleton.** ADR-0009's `create*` rule
 * carried across the wire, for the reason it has on the API: the seam is a
 * parameter. `app/providers/i18n.tsx` calls this once and hands the instance to
 * `I18nextProvider`; a test calls it with a locale and nothing else; and D8
 * lifts the module into a package without an app wired into it.
 *
 * A singleton would also be wrong twice over in the suite ADR-0036 specifies:
 * two files rendering at different locales would share one instance, and the
 * cached `test:unit` loop would stop being a pure function of the tree.
 */

/**
 * One dynamic `import()` per `<locale>/<namespace>.json`, so Vite emits a
 * chunk per catalogue and a Latvian operator downloads Latvian while an
 * English one downloads nothing extra (ADR-0046 §3).
 *
 * No HTTP backend and no `public/locales`: the catalogues are code, hashed and
 * shipped like code, and nothing fetches JSON from the page origin at runtime
 * — which is the CSP reason as much as the bundling one.
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
 * The active locale, written where the rest of the document can see it.
 *
 * `<html lang>` carries the **Intl tag**, not the bare enum member: it is what
 * a screen reader picks a voice from and what a browser hyphenates by, and
 * `en-GB` is the decision ADR-0046 §5 made about what `en` means here. The
 * device cache is written in the same breath, because a locale that is not
 * remembered is one the login screen has to guess again tomorrow.
 *
 * `setIntlLocale` joined it at `D7.2`: the grid's date formatters read the tag
 * from `intl.ts`, and swapping it *here* — inside the listener that runs before
 * react-i18next's own — is what makes a locale switch move the dates in the
 * same paint as the headers rather than one render later.
 */
const applyLocale = (locale: Locale, translate: TranslateKey): void => {
  setIntlLocale(locale);
  document.documentElement.lang = INTL_TAGS[locale];
  writeStoredLocale(locale);
  /*
   * And the schemas with them (`D7.5`, ADR-0046 §6). The field rules an
   * operator reads are zod's own messages, so a locale that moved the headers
   * and left `Too small: expected string to have >=12 characters` underneath
   * the password box would have localised everything except the sentence the
   * operator is being asked to act on.
   *
   * Fire-and-forget: `lv`'s map is a chunk, and nothing on this tick is waiting
   * for a validation message. `changeLocale` awaits it for the caller that is.
   */
  applyZodLocale(locale, createRuleTranslator(translate));
};

export interface CreateI18nOptions {
  readonly resources: Catalogues;
  readonly namespaces: readonly Namespace[];
  readonly locale: Locale;
  /**
   * The dev-only lens of ADR-0046 §10, off by default.
   *
   * An option on the factory rather than a read of `import.meta.env` inside it,
   * for the reason every other seam here is a parameter: `app/providers` is
   * where configuration is read (ADR-0004's one reader is `shared/config`), and
   * `D7.6`'s route suite switches it on without an environment at all.
   */
  readonly pseudo?: boolean;
}

export const createI18n = ({
  resources,
  namespaces,
  locale,
  pseudo = false,
}: CreateI18nOptions) => {
  const instance = i18next.createInstance();

  /*
   * Subscribed before `init`, so the listener catches the language i18next
   * settles on rather than only the ones changed afterwards. `D7.5` adds the
   * zod error map to this handler and `D7.2` the formatter rebuild; today it
   * is the document's language and the device cache, which is the whole of
   * what a locale means before there is any copy to translate.
   */
  instance.on("languageChanged", (language: string) => {
    applyLocale(
      asLocale(language) ?? DEFAULT_LOCALE,
      instance.t as TranslateKey,
    );
  });

  /*
   * The lens goes on before `init`, and only when it was asked for. A
   * post-processor that is registered and disabled still runs on every
   * translation to decide it has nothing to do, and this is the hottest
   * function in the app.
   */
  if (pseudo) instance.use(createPseudoPostProcessor());

  void instance
    .use(initReactI18next)
    .use(resourcesToBackend(loadCatalogue))
    .init({
      /*
       * Named only when the module was registered: i18next warns about a
       * post-processor it cannot find, once per translated string.
       */
      ...(pseudo ? { postProcess: [PSEUDO_POST_PROCESSOR] } : {}),
      /*
       * The bare enum member and not the Intl tag: `lng` is what selects a
       * catalogue and what `Intl.PluralRules` resolves a category from, and
       * `lv` and `lv-LV` answer the same categories. Regional tags belong to
       * the formatters, which read `INTL_TAGS` (ADR-0046 §5, amended `D7.1`);
       * putting one here would make i18next look for an `en-GB` catalogue that
       * does not exist and then fall back to find the one that does.
       */
      lng: locale,
      fallbackLng: DEFAULT_LOCALE,
      supportedLngs: [...LOCALES],
      ns: [...namespaces],
      defaultNS: DEFAULT_NAMESPACE,
      resources: resources as Resource,
      /*
       * Without this, a bundled `resources` switches the backend off entirely
       * and `lv` would silently never load — the failure mode is a Latvian
       * operator reading English with no error anywhere.
       */
      partialBundledLanguages: true,
      returnNull: false,
      // React escapes its own children; i18next doing it again turns an
      // apostrophe into `&#39;` on screen.
      interpolation: { escapeValue: false },
      /*
       * Synchronous init for a locale already in `resources`, which is what
       * lets a test render at `en` without awaiting anything — and therefore
       * what keeps `test:unit` a pure function of the tree (ADR-0046 §14).
       *
       * The option is `initAsync` in i18next 26; `initImmediate` was its name
       * up to v25 and is the spelling every recipe still carries. It is not
       * merely renamed — the sense is the same and the *default* is the same,
       * so a copied `initImmediate: false` is silently ignored and the
       * instance initialises asynchronously anyway.
       */
      initAsync: false,
      /*
       * **No suspense** (ADR-0046 §13, amended `D7.1`). react-i18next's
       * default is to suspend a component whose namespace has not arrived,
       * and every locale but `en` arrives through a dynamic `import()` — so
       * the default would unmount whole subtrees on a locale switch and
       * demand a `<Suspense>` boundary above every translated component in
       * the app.
       *
       * Not suspending costs one render in the `en` fallback, which is the
       * fallback the operator would have seen anyway for a key `lv` is
       * missing; react-i18next re-renders on `loaded`.
       */
      react: { useSuspense: false },
    });

  applyLocale(locale, instance.t as TranslateKey);

  return {
    instance,
    changeLocale: async (next: Locale): Promise<void> => {
      await instance.changeLanguage(next);
      /*
       * The zod maps are installed by the listener above, which does not wait
       * for `lv`'s chunk. Awaiting it here is what lets a caller — a test, or
       * a control that wants the next submit to be in the new language — treat
       * "the locale changed" as one settled event rather than two.
       */
      await zodLocaleReady();
    },
    t: instance.t,
  } as const;
};

export type I18n = ReturnType<typeof createI18n>;

/**
 * The precedence of ADR-0046 §4 with its two impure sources read.
 *
 * The pure half is {@link resolveInitialLocale}, which is where the decision
 * is tested; this is the two lines that touch the browser.
 */
export const preferredLocale = (settings: Locale | null = null): Locale =>
  resolveInitialLocale({
    settings,
    stored: readStoredLocale(),
    navigator: navigatorLocales(),
  });

export {
  asLocale,
  navigatorLocales,
  resolveInitialLocale,
  type LocaleSources,
} from "./resolve-locale";
export {
  LOCALE_STORAGE_KEY,
  readStoredLocale,
  writeStoredLocale,
} from "./locale-storage";
export { INTL_TAGS } from "./tags";
export {
  LocalePublisherProvider,
  useLocale,
  type LocalePublisher,
  type LocalePublisherProviderProps,
  type LocaleView,
} from "./locale-context";
export { activeIntlTag, dateTimeFormat, setIntlLocale } from "./intl";
export { PSEUDO_POST_PROCESSOR, createPseudoPostProcessor } from "./pseudo";
export { DEFAULT_NAMESPACE, NAMESPACES, type Namespace } from "./namespaces";
export { EN_RESOURCES, type Catalogue, type Catalogues } from "./resources";
export {
  RULE_KEYS,
  applyZodLocale,
  createRuleTranslator,
  zodLocaleReady,
  type RuleTranslator,
} from "./zod-locale";
export {
  createDeferredTranslate,
  dynamicKey,
  englishTranslation,
  useKeyT,
  type DeferredTranslate,
  type TranslateKey,
} from "./keys";
export type { TranslationKey } from "./types";
export {
  PseudoNoticeProvider,
  usePseudoNotice,
  type PseudoNoticeProviderProps,
} from "./pseudo-notice";

/**
 * The hook, under the name the rest of the app uses. Re-exported here so a
 * slice imports one module for its keys and its translator, and so the day the
 * library changes there is one import to rewrite (ADR-0046 §13).
 */
export { useTranslation as useT } from "react-i18next";
