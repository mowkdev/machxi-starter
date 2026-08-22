import type { TFunction } from "i18next";
import { useMemo } from "react";

import { isApiClientError } from "@/shared/api/api-error";
import { useT } from "@/shared/i18n";
import enErrors from "@/shared/i18n/locales/en/errors.json";

/**
 * The sentence an operator reads for a failure (ADR-0034 §Notifications,
 * ADR-0046 §2).
 *
 * D3 kept it as `ERROR_MESSAGES: Record<ErrorCode, string>` and called itself
 * "the i18n seam" in its own header. `D7.2` is that seam being used: the map is
 * now `locales/en/errors.json`, keyed by `ErrorCode` exactly as it was keyed
 * before, and the lookup is `t()` in the `errors` namespace.
 *
 * **Two properties had to survive the move, and both did.**
 *
 * - *Compile-time completeness.* `Record<ErrorCode, string>` made a code added
 *   to `@repo/contracts` a red build until somebody wrote a sentence for it. A
 *   JSON catalogue carries no such type, so the guarantee moved to a type-level
 *   check in `shared/i18n/__checks__/errors.ts` — compiled, never imported.
 * - *The runtime fallback.* An older bundle can meet a newer API, and a code
 *   this build has never heard of is what `@repo/contracts` tells clients to
 *   degrade on. `defaultValue` is that instruction followed: i18next returns
 *   the key itself for a missing entry, and a raw `SCREAMING_SNAKE` on screen
 *   is precisely the outcome the catalogue exists to prevent.
 *
 * The wording is for an operator, not a developer: it says what happened and,
 * where there is one, what to do. The API's own `message` is a developer-facing
 * English default (ADR-0013) and is deliberately not shown.
 */

/**
 * The lookup, with the same signature it has had since D3.
 *
 * Producing it from a factory rather than exporting it directly is what lets it
 * keep that signature while gaining a locale: ADR-0046 §13 forbids a
 * module-level i18next singleton, so the translator has to arrive from
 * somewhere, and a closure is the only place it can arrive without being an
 * argument at every call site.
 */
export type ErrorMessage = (error: unknown) => string;

/**
 * A translator fixed to the `errors` namespace, which is the namespace keyed by
 * `ErrorCode` — so the key *is* the code, with no prefix to get wrong.
 */
export type ErrorTranslate = TFunction<"errors">;

export const createMessageForError =
  (t: ErrorTranslate): ErrorMessage =>
  (error) => {
    const fallback = t("fallback");

    if (!isApiClientError(error)) return fallback;

    return t(error.code, { defaultValue: fallback });
  };

/**
 * What the app uses before an i18next instance is mounted, and what a consumer
 * built above the provider falls back to.
 *
 * It is not a second catalogue: it reads the same eagerly bundled `en` JSON the
 * instance is initialised from, so there is exactly one place a sentence is
 * written. `en` is also the fallback locale (ADR-0046 §3), so degrading to it
 * degrades to the language the operator would have seen for a missing key
 * anyway.
 */
const EN_ERRORS: Readonly<Record<string, string>> = enErrors;

export const englishMessageForError: ErrorMessage = (error) =>
  (isApiClientError(error) ? EN_ERRORS[error.code] : undefined) ??
  enErrors.fallback;

/**
 * The hook every component uses.
 *
 * `t` changes identity on `languageChanged`, so the memo rebuilds and anything
 * holding the result re-renders with it — which is what makes an error panel
 * follow a locale switch without a reload.
 */
export const useMessageForError = (): ErrorMessage => {
  const { t } = useT("errors");

  return useMemo(() => createMessageForError(t), [t]);
};

/**
 * The one consumer that is constructed before any instance exists: ADR-0034's
 * global cache handlers (`app/providers/query-client.ts`).
 *
 * They are built with the query client at the composition root, and the
 * instance is built *inside* `SettingsProvider`, where the account's locale is
 * already known (`D7.1`, ADR-0046 §4). That ordering is deliberate and this is
 * the wire between the two ends of it: the handlers hold a stable function, and
 * `bind` swaps what it resolves through once the provider mounts.
 *
 * It is a **factory**, not a module-level box, for the reason `createI18n` is:
 * the app creates one and the suite creates one per render, so a test that
 * switched language cannot leave the next file's toasts in Latvian.
 */
export interface DeferredErrorMessage {
  /** Stable across binds — safe to close over at construction time. */
  readonly messageForError: ErrorMessage;
  readonly bind: (t: ErrorTranslate) => void;
}

export const createDeferredErrorMessage = (): DeferredErrorMessage => {
  let resolve: ErrorMessage = englishMessageForError;

  return {
    messageForError: (error) => resolve(error),
    bind: (t) => {
      resolve = createMessageForError(t);
    },
  };
};
