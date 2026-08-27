import {
  createDeferredTranslate as createDeferredTranslateWith,
  type DeferredTranslate,
  type TranslationKey,
} from "@repo/i18n";

import { EN_RESOURCES } from "./resources";

/**
 * The half of ADR-0046 §7's translator seam that reads *this app's*
 * catalogues, and therefore could not travel (`D9.2`, ADR-0051).
 *
 * The shapes moved to `@repo/i18n`; the one binding that needs a value only
 * this app has is made here, so every call site keeps the name and the
 * signature it had before the extraction. (`useKeyT` was a second such binding
 * until `D9.4`, which made it read the namespace list off the mounted instance
 * instead — a package's grid components need it too, and cannot name an app's
 * namespaces.)
 *
 * - **`createDeferredTranslate`** is the package's, with
 *   {@link englishTranslation} supplied as the pre-instance fallback.
 */

/**
 * The `en` sentence for a key, with no instance in hand.
 *
 * The sibling of `englishMessageForError`, and it exists for the same consumer:
 * ADR-0034's global mutation handler is constructed at the composition root and
 * a mutation's `meta.success` is now a key, so something has to be able to
 * resolve one before `SettingsProvider` has built the instance. It reads the
 * same eagerly bundled catalogue the instance is initialised from, so there is
 * exactly one place a sentence is written — which is also precisely why this
 * function stayed in the app while the rest of the seam moved.
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
 * The app's binder, with the English catalogue as its floor. Same name and
 * same signature as before `D9.2` — the fallback became a parameter of the
 * package's factory, and this is the one place that supplies it.
 */
export const createDeferredTranslate = (): DeferredTranslate =>
  createDeferredTranslateWith(englishTranslation);
