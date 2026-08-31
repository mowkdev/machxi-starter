import type { TFunction } from "i18next";
import { useMemo } from "react";

import { isApiClientError, type ErrorMessage } from "@/shared/api/api-error";
import { useT } from "@/shared/i18n";

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
 * **What is not here yet**: `englishMessageForError` and
 * `createDeferredErrorMessage`, the admin's pair for ADR-0034's global cache
 * handlers. Those are constructed with the query client at the composition
 * root, before any i18next instance exists — and this app has no query client
 * until `D12.6` has something to fetch. Building the deferred half now would be
 * a wire with nothing on either end.
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
