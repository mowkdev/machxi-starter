import {
  createDeferredTranslate as createDeferredTranslateWith,
  type DeferredTranslate,
  type TranslationKey,
} from "@repo/i18n";

import { EN_RESOURCES } from "./resources";

/**
 * The half of ADR-0046 §7's translator seam that reads *this app's* catalogues,
 * and therefore could not travel into `@repo/i18n` (`D12.6`, ADR-0051).
 *
 * Its own module rather than part of the barrel, for the reason
 * `namespaces.ts` is: `index.ts` re-exports this file and this file reads
 * `resources.ts`, so leaving the pair in the barrel would make them a cycle.
 */

/**
 * The `en` sentence for a key, with no instance in hand.
 *
 * The sibling of `englishMessageForError`, and it exists for the same consumer:
 * ADR-0034's global mutation handler is constructed at the composition root —
 * above `I18nProvider`, which sits inside the session gate — and a mutation's
 * `meta.success` is a key, so something has to be able to resolve one before
 * any instance exists. It reads the same eagerly bundled catalogue the instance
 * is initialised from, so there is exactly one place a sentence is written.
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
 * The app's binder, with the English catalogue as its floor.
 *
 * A factory rather than a module-level box, for the reason `createI18n` is: the
 * app creates one and the suite creates one per render, so a test that switched
 * language cannot leave the next file's toasts in Latvian.
 */
export const createDeferredTranslate = (): DeferredTranslate =>
  createDeferredTranslateWith(englishTranslation);
