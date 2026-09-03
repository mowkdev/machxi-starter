import type { TFunction } from "i18next";
import { useMemo } from "react";

import { isApiClientError, type ErrorMessage } from "@/shared/api/api-error";
import { useT } from "@/shared/i18n";
import enErrors from "@/shared/i18n/locales/en/errors.json";

/**
 * The sentence a customer reads for a failure (ADR-0034 §Notifications,
 * ADR-0046 §2).
 *
 * The lookup is `t()` in the `errors` namespace, which is keyed by `ErrorCode`
 * exactly — so the key *is* the code, with no prefix to get wrong. Two
 * properties carry over from the admin's, and both are why this file exists at
 * all rather than components calling `t()` themselves:
 *
 * - *Compile-time completeness.* A code added to `@repo/contracts` is a red
 *   build until somebody writes a sentence for it — `shared/i18n/__checks__/errors.ts`.
 * - *The runtime fallback.* An older bundle can meet a newer API, and a code
 *   this build has never heard of is what `@repo/contracts` tells clients to
 *   degrade on. `defaultValue` is that instruction followed: i18next returns
 *   the key itself for a missing entry, and a raw `SCREAMING_SNAKE` on screen
 *   is precisely what the catalogue exists to prevent.
 *
 * **The API's own `message` is never rendered.** It is a developer-facing
 * English default (ADR-0013); showing it bypasses the i18n seam this module is,
 * and puts wording nobody wrote for a customer on a customer's screen.
 *
 * **`englishMessageForError` and `createDeferredErrorMessage` arrived at
 * `D12.6`**, with the query client whose global cache handlers are their only
 * consumer. They were named as absent at `D12.2` on the grounds that a wire
 * with nothing on either end is not worth building; the account area put
 * something on both ends.
 */

export type { ErrorMessage };

/**
 * A translator fixed to the `errors` namespace.
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
 * The hook every component uses.
 *
 * `t` changes identity on `languageChanged`, so the memo rebuilds and anything
 * holding the result re-renders with it — which is what makes a refusal follow
 * a locale switch without a reload.
 */
export const useMessageForError = (): ErrorMessage => {
  const { t } = useT("errors");

  return useMemo(() => createMessageForError(t), [t]);
};

/**
 * What the app uses before an i18next instance is mounted, and what a consumer
 * built above the provider falls back to.
 *
 * It is not a second catalogue: it reads the same eagerly bundled `en` JSON the
 * instance is initialised from, so there is exactly one place a sentence is
 * written. `en` is also the fallback locale (ADR-0046 §3), so degrading to it
 * degrades to the language a customer would have seen for a missing key anyway.
 */
const EN_ERRORS: Readonly<Record<string, string>> = enErrors;

export const englishMessageForError: ErrorMessage = (error) =>
  (isApiClientError(error) ? EN_ERRORS[error.code] : undefined) ??
  enErrors.fallback;

/**
 * The one consumer that is constructed before any instance exists: ADR-0034's
 * global cache handlers (`@repo/app-kit`, through `shared/api/query-client`).
 *
 * They are built with the query client at the composition root, and the
 * instance is built *inside* the session gate, in `I18nProvider`. That ordering
 * is deliberate — a query fired before the session is hydrated would go out
 * without a token — and this is the wire between the two ends of it: the
 * handlers hold a stable function, and `bind` swaps what it resolves through
 * once the provider mounts.
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
