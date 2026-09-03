import { DEFAULT_LOCALE, LOCALES, type Locale } from "@repo/contracts";
import i18next, {
  type i18n as I18nextInstance,
  type Resource,
  type ResourceKey,
} from "i18next";
import resourcesToBackend from "i18next-resources-to-backend";
import { initReactI18next } from "react-i18next";

import { setIntlLocale } from "./intl";
import type { TranslateKey } from "./keys";
import { readStoredLocale, writeStoredLocale } from "./locale-storage";
import { PSEUDO_POST_PROCESSOR, createPseudoPostProcessor } from "./pseudo";
import {
  asLocale,
  navigatorLocales,
  resolveInitialLocale,
} from "./resolve-locale";
import { INTL_TAGS } from "./tags";

/**
 * One catalogue set: every namespace an app declares, for one locale.
 *
 * **Generic since `D9.2`** (ADR-0051). It was `Readonly<Record<Namespace,
 * object>>` over the admin's ten-name union, which is precisely the thing a
 * package cannot know — so the names are `string` here and the app's own
 * `Catalogue`/`Catalogues` types (still exactly as narrow as they were) are
 * what its composition root passes in. The compiler still checks the app's
 * side; the package only requires the shape.
 */
export type Catalogue = Readonly<Record<string, object>>;

export type Catalogues = Readonly<Partial<Record<Locale, Catalogue>>> & {
  readonly en: Catalogue;
};

/**
 * The i18n seam (ADR-0046 §3, §5, §13). `D7.1` landed it empty; `D7.2`, `D7.3`
 * and `D7.4` filled the ten `en` catalogues it initialises from, and `D9.2`
 * moved it here (ADR-0051) so a second app builds its instance from the same
 * factory rather than from a copy of it. The catalogues and the namespace
 * list stay the app's and arrive as parameters, which is what D7 built the
 * factory shape for.
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
/**
 * What every locale change must do, wherever it came from.
 *
 * The three lines that are the package's — the Intl formatters, the document
 * language, the stored preference — followed by whatever else the app needs
 * doing. **That fourth thing is a parameter since `D9.2`** (ADR-0051): the
 * admin installs zod's locale here (ADR-0046 §6), because the field rules an
 * operator reads are zod's own messages and a locale that moved the headers
 * and left `Too small: expected string to have >=12 characters` under the
 * password box would have localised everything except the sentence the
 * operator is being asked to act on. Those rules are keys in the `form`
 * namespace, which is `@repo/form`'s since `D9.5` and never this package's —
 * so the installer lives there and arrives here as a parameter, because a
 * package cannot name a key it does not own (ADR-0046 §13).
 */
const applyLocale = (
  locale: Locale,
  keyPrefix: string,
  translate: TranslateKey,
  onLocaleApplied:
    ((locale: Locale, translate: TranslateKey) => void) | undefined,
): void => {
  setIntlLocale(locale);
  document.documentElement.lang = INTL_TAGS[locale];
  writeStoredLocale(keyPrefix, locale);
  onLocaleApplied?.(locale, translate);
};

export interface CreateI18nOptions {
  readonly resources: Catalogues;
  /**
   * The device-key prefix this app owns, `${appId}.${segment}` (ADR-0064 §1).
   *
   * A parameter for the reason the catalogues are one: a package may not hold
   * an app's identity. The composition root builds it from `VITE_APP_ID` and
   * the segment it already declares to `createApiClient`, and this factory
   * writes exactly one key under it.
   */
  readonly storageKeyPrefix: string;
  readonly namespaces: readonly string[];
  /**
   * What an unprefixed key means (`D9.2`, ADR-0051).
   *
   * The app's, because the namespace list is: `apps/admin` declares `common`
   * for chrome and generic actions. **Defaults to the first namespace**, which
   * is that same value in the shipped list — an explicit default rather than a
   * hardcoded `"common"`, because a package that assumed one app's namespace
   * name would be a package holding a string it does not own. The composition
   * root passes it anyway, so the intent is stated once where it belongs.
   */
  readonly defaultNamespace?: string;
  /**
   * What else a locale change must do, beyond Intl, `<html lang>` and the
   * stored preference (`D9.2`, ADR-0051).
   *
   * `apps/admin` installs zod's error map here, from the installer `@repo/form`
   * owns since `D9.5`. It is a parameter rather than a step in this factory
   * because the rule copy is keyed in the `form` namespace, which is that
   * package's and not this one's — a package may not name a key it does not
   * own (ADR-0046 §13) — and because a consumer with no zod schemas should not
   * pay for one.
   */
  readonly onLocaleApplied?: (locale: Locale, translate: TranslateKey) => void;
  /**
   * Anything the above kicked off that a caller may want to await.
   *
   * `changeLocale` resolves only once this does, which is what lets a caller —
   * a test, or a control that wants the next submit in the new language —
   * treat "the locale changed" as one settled event rather than two. The
   * admin passes `zodLocaleReady`, whose `lv` map is a lazily-imported chunk.
   */
  readonly localeSideEffectsReady?: () => Promise<void>;
  /**
   * How a locale that is not bundled eagerly is fetched (`D9.2`, ADR-0051).
   *
   * **The app's, because the catalogues are.** It used to be a module-level
   * function here doing `import("./locales/${language}/${namespace}.json")` —
   * a relative specifier, which resolves against *this* module and so pointed
   * at the package the moment the factory moved. The admin passes a loader
   * whose specifier is relative to its own `locales/`, which is the only place
   * that path is knowable.
   *
   * Omitted, no backend is registered and only the eagerly-passed `resources`
   * resolve, which is the right answer for a consumer that bundles every
   * locale. No HTTP backend and no `public/locales` either way: the catalogues
   * are code, hashed and shipped like code, and nothing fetches JSON from the
   * page origin at runtime — the CSP reason as much as the bundling one.
   */
  readonly loadCatalogue?: (
    language: string,
    namespace: string,
  ) => Promise<ResourceKey>;
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

/**
 * What the factory hands back.
 *
 * **Written out rather than inferred** (`D14.9`, ADR-0062 §3). It was
 * `ReturnType<typeof createI18n>`, which a declaration emit cannot name: the
 * inferred shape reaches into `i18next`'s own types through a relative path
 * into `node_modules`, and `tsc -b` refuses to write that into a `.d.ts`
 * (TS2742) because the path is not portable. An interface at the seam is the
 * fix the compiler asks for, and it is the honest one — this is the package's
 * public surface, so it belongs in the source rather than in an inference.
 */
export interface I18n {
  readonly instance: I18nextInstance;
  readonly changeLocale: (next: Locale) => Promise<void>;
  readonly t: I18nextInstance["t"];
}

export const createI18n = ({
  resources,
  storageKeyPrefix,
  namespaces,
  locale,
  defaultNamespace,
  loadCatalogue,
  onLocaleApplied,
  localeSideEffectsReady,
  pseudo = false,
}: CreateI18nOptions): I18n => {
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
      storageKeyPrefix,
      instance.t as TranslateKey,
      onLocaleApplied,
    );
  });

  /*
   * The lens goes on before `init`, and only when it was asked for. A
   * post-processor that is registered and disabled still runs on every
   * translation to decide it has nothing to do, and this is the hottest
   * function in the app.
   */
  if (pseudo) instance.use(createPseudoPostProcessor());

  if (loadCatalogue) instance.use(resourcesToBackend(loadCatalogue));

  void instance.use(initReactI18next).init({
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
    /*
     * `false` is i18next's "no default namespace", and it is the honest
     * answer for an empty list rather than a placeholder string: every key
     * must then carry its prefix. `namespaces[0]` is `string | undefined`
     * under `noUncheckedIndexedAccess`, so the third arm is required and
     * says what an app with no namespaces gets.
     */
    defaultNS: defaultNamespace ?? namespaces[0] ?? false,
    /*
     * **A copy per locale, not the caller's object** (`D9.2`, ADR-0046 §13).
     *
     * `ResourceStore` holds what `init` is handed *by reference*, and
     * `addResourceBundle` writes into that same object — so a package
     * registering its namespace (see `./register`) would write it into the
     * caller's module-level catalogue, and every instance built from that
     * catalogue afterwards would see it. That is precisely the cross-instance
     * sharing the factory rule exists to prevent: `D7.1` put the instance
     * inside a provider so a suite gets one per render, and a leak here
     * would hand the next render the previous one's registrations.
     *
     * One level is enough for what `register` does — it adds a namespace
     * key — and a namespace it collides with is refused by `overwrite: false`
     * before any nested write happens.
     */
    resources: Object.fromEntries(
      Object.entries(resources).map(([language, catalogue]) => [
        language,
        { ...catalogue },
      ]),
    ) as Resource,
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

  applyLocale(
    locale,
    storageKeyPrefix,
    instance.t as TranslateKey,
    onLocaleApplied,
  );

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
      await localeSideEffectsReady?.();
    },
    t: instance.t,
  } as const;
};

/**
 * The precedence of ADR-0046 §4 with its two impure sources read.
 *
 * The pure half is {@link resolveInitialLocale}, which is where the decision
 * is tested; this is the two lines that touch the browser.
 */
export const preferredLocale = (
  storageKeyPrefix: string,
  settings: Locale | null = null,
): Locale =>
  resolveInitialLocale({
    settings,
    stored: readStoredLocale(storageKeyPrefix),
    navigator: navigatorLocales(),
  });
