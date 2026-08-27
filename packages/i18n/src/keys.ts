import type { TOptions } from "i18next";
import { useTranslation } from "react-i18next";

import type { TranslationKey } from "./types";

/**
 * The translator seam (ADR-0046 §7), extracted (`D9.2`, ADR-0051).
 *
 * **What is here and what stayed is decided by one question: does it read the
 * app's catalogue?** The type, the runtime-key escape hatch and the deferred
 * binder do not — they are shapes over whatever `TranslationKey` resolves to,
 * so they are the package's. `englishTranslation`, which walks the app's
 * eagerly-bundled `EN_RESOURCES` looking for a sentence, does, and stayed in
 * `apps/admin/src/shared/i18n`.
 *
 * The two things that need a value the package cannot know — the namespace
 * list and the pre-instance fallback — are parameters here and bound once in
 * the app's door, so every call site keeps the name and the signature it had.
 */

export type TranslateKey = (key: TranslationKey, options?: TOptions) => string;

/**
 * Builds the hook every renderer of config copy uses, bound to one app's
 * namespaces.
 *
 * **A factory since `D9.2`, and the reason is the namespace list rather than
 * taste.** The hook must bind to *all* of an app's namespaces: `useTranslation()`
 * with no argument loads `common` alone, and a `t("staff:title")` through it
 * would resolve only because something else happened to have loaded `staff` —
 * true today, because `init` is given the whole list, and false the moment a
 * namespace is loaded on demand. Naming them makes the dependency real, and
 * only the app knows its own names, so it hands them in once.
 *
 * `t` re-identifies on `languageChanged`, so a component holding one re-renders
 * with the new language and every config-supplied label follows a locale switch
 * without a reload.
 *
 * **The parameter is typed as whatever `useTranslation` accepts**, rather than
 * as `readonly string[]`. react-i18next types that argument against the
 * namespaces merged into i18next's options, so from inside a consuming app it
 * is that app's own union — which means the app's list satisfies it exactly,
 * a typo in it is still a compile error, and this package names no namespace
 * and needs no cast to hand the list over.
 */
export const createUseKeyT =
  (namespaces: Parameters<typeof useTranslation>[0]): (() => TranslateKey) =>
  () => {
    const { t } = useTranslation(namespaces);

    /*
     * The one cast in the seam. `TFunction` over a namespace tuple and
     * `TranslateKey` accept the same keys — both are `ParseKeys` over the same
     * declaration merge — but `TFunction`'s overloads are wider on the way out
     * (`ReturnType` is generic in the options), and narrowing a call signature
     * is not something the compiler will do for free.
     */
    return t as TranslateKey;
  };

/**
 * A key composed at runtime, admitted deliberately and in one place.
 *
 * Almost every key in an app is a literal the compiler checks. Enum option
 * labels cannot be: `common:options.<value>` is derived from a contracts tuple
 * (`STAFF_STATUSES`, `STAFF_ROLES`), and spelling the members out in a config
 * would mean a status added to `@repo/contracts` renders a control the
 * catalogue silently disagreed with.
 *
 * So the cast lives here, once, rather than at each caller, and the callers
 * that use it always pass a `defaultValue` — `humanize(value)`, the pre-D7
 * behaviour — so a value with no catalogue entry degrades to exactly what it
 * rendered before rather than to a raw key.
 *
 * The cost is named because the extractor inherits it: `i18next-parser` cannot
 * see these keys, so `common:options.*` is a block it must be told to keep.
 * Every key a *config* carries has the same property for the same reason —
 * none of them appears inside a `t()` call in the source.
 */
export const dynamicKey = (key: string): TranslationKey =>
  key as TranslationKey;

/**
 * A translator something can close over before an instance exists (ADR-0046
 * §2's `createDeferredErrorMessage`, applied to `meta.success`).
 *
 * The two ends are fixed and neither may move: ADR-0034 gives one query client
 * to the whole app and `app/index.tsx` builds it at module scope, while `D7.1`
 * put the i18next instance *inside* `SettingsProvider`, where the account's
 * locale is already known. A factory rather than a module-level box, so a
 * suite gets one per render and a test that switched language cannot leave the
 * next file's toasts in Latvian.
 *
 * **The fallback is a parameter since `D9.2`.** It used to default to
 * `englishTranslation`, which reads the app's own bundled catalogue — the one
 * thing in this file that could not travel. The app's door passes it, so the
 * behaviour before an instance exists is unchanged.
 */
export interface DeferredTranslate {
  /** Stable across binds — safe to close over at construction time. */
  readonly translate: TranslateKey;
  readonly bind: (t: TranslateKey) => void;
}

export const createDeferredTranslate = (
  fallback: TranslateKey,
): DeferredTranslate => {
  let resolve: TranslateKey = fallback;

  return {
    translate: (key, options) => resolve(key, options),
    bind: (t) => {
      resolve = t;
    },
  };
};
