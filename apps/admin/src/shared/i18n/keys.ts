import type { TOptions } from "i18next";
import { useTranslation } from "react-i18next";

import { NAMESPACES } from "./namespaces";
import { EN_RESOURCES } from "./resources";
import type { TranslationKey } from "./types";

/**
 * The translator that resolves the keys **configs carry** (ADR-0046 §7,
 * `D7.4`).
 *
 * `useT("grid")` is right for a module whose copy is all one namespace's: the
 * key it resolves is a `grid` key and the compiler says so. It is exactly wrong
 * for the machinery `D7.4` feeds, because a `ResourceConfig`'s `header` is a
 * key from *whatever namespace the resource owns* — `AppGrid` renders staff and
 * users and must learn neither name (ADR-0032). So the machinery takes a
 * translator over every namespace and the key travels with the data, which is
 * the same division ADR-0035 already draws for formatter and renderer names.
 *
 * A `TranslationKey` is a union of literals, so a typo'd key is a compile error
 * at the config that wrote it rather than a raw `staff:colums.email` on screen
 * — the property the registries have had since D3.
 */
export type TranslateKey = (key: TranslationKey, options?: TOptions) => string;

/**
 * The hook every renderer of config copy uses.
 *
 * Bound to **all** namespaces rather than to none: `useTranslation()` with no
 * argument loads `common` alone, and a `t("staff:title")` through it would
 * resolve only because something else happened to have loaded `staff` — which
 * is true today, because `init` is given the whole list, and would stop being
 * true the moment a namespace was loaded on demand. Naming them makes the
 * dependency real.
 *
 * `t` re-identifies on `languageChanged`, so a component holding one re-renders
 * with the new language and every config-supplied label follows a locale switch
 * without a reload.
 */
export const useKeyT = (): TranslateKey => {
  const { t } = useTranslation(NAMESPACES);

  /*
   * The one cast in the seam. `TFunction` over a namespace tuple and
   * `TranslateKey` accept the same keys — both are `ParseKeys` over the same
   * declaration merge — but `TFunction`'s overloads are wider on the way out
   * (`ReturnType` is generic in the options), and narrowing a call signature is
   * not something the compiler will do for free.
   */
  return t as TranslateKey;
};

/**
 * A key composed at runtime, admitted deliberately and in one place.
 *
 * Almost every key in this app is a literal the compiler checks. Enum option
 * labels cannot be: `common:options.<value>` is derived from a contracts tuple
 * (`STAFF_STATUSES`, `STAFF_ROLES`), and spelling the members out in a config
 * would be the one place ADR-0023's "declared once" property is copied — a
 * status added to `@repo/contracts` would then render a control the catalogue
 * silently disagreed with.
 *
 * So the cast lives here, once, rather than at each caller, and the callers
 * that use it always pass a `defaultValue` — `humanize(value)`, the pre-D7
 * behaviour — so a value with no catalogue entry degrades to exactly what it
 * rendered before rather than to a raw key.
 *
 * The cost is named because `D7.6` inherits it: `i18next-parser` cannot see
 * these keys, so `common:options.*` is a block the extractor must be told to
 * keep. Every key a *config* carries has the same property for the same reason
 * — none of them appears inside a `t()` call in the source.
 */
export const dynamicKey = (key: string): TranslationKey =>
  key as TranslationKey;

/**
 * The `en` sentence for a key, with no instance in hand.
 *
 * The sibling of `englishMessageForError`, and it exists for the same consumer:
 * ADR-0034's global mutation handler is constructed at the composition root and
 * a mutation's `meta.success` is now a key, so something has to be able to
 * resolve one before `SettingsProvider` has built the instance. It reads the
 * same eagerly bundled catalogue the instance is initialised from, so there is
 * exactly one place a sentence is written.
 *
 * No interpolation and no plurals: this is a floor, not a second translator,
 * and the keys that reach it are static outcome sentences.
 */
export const englishTranslation = (key: TranslationKey): string => {
  const [namespace, path] = String(key).split(":", 2);

  if (path === undefined) return String(key);

  const catalogue: unknown =
    EN_RESOURCES[namespace as keyof typeof EN_RESOURCES];

  const found = path
    .split(".")
    .reduce<unknown>(
      (node, segment) =>
        typeof node === "object" && node !== null
          ? (node as Record<string, unknown>)[segment]
          : undefined,
      catalogue,
    );

  return typeof found === "string" ? found : String(key);
};

/**
 * A translator the global cache handler can close over before one exists
 * (ADR-0046 §2's `createDeferredErrorMessage`, applied to `meta.success`).
 *
 * The two ends are fixed and neither may move: ADR-0034 gives one query client
 * to the whole app and `app/index.tsx` builds it at module scope, while `D7.1`
 * put the i18next instance *inside* `SettingsProvider`, where the account's
 * locale is already known. A factory rather than a module-level box, so the
 * suite gets one per render and a test that switched language cannot leave the
 * next file's toasts in Latvian.
 */
export interface DeferredTranslate {
  /** Stable across binds — safe to close over at construction time. */
  readonly translate: TranslateKey;
  readonly bind: (t: TranslateKey) => void;
}

export const createDeferredTranslate = (): DeferredTranslate => {
  let resolve: TranslateKey = englishTranslation;

  return {
    translate: (key, options) => resolve(key, options),
    bind: (t) => {
      resolve = t;
    },
  };
};
