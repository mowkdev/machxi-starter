import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { isApiClientError } from "@/shared/api/api-error";
import { englishTranslation, type TranslateKey } from "@/shared/i18n";
import {
  englishMessageForError,
  type ErrorMessage,
} from "@/shared/notifications/messages";
// Side-effect import: the module declares the `meta` augmentation every layer
// relies on, and a type-only import would be erased before it applied.
import "@/shared/api/query-meta";
import { toast } from "@/shared/ui";

/**
 * The query client and its notification policy (ADR-0034).
 *
 * A `create*` wrapper because ADR-0009 says third-party constructors are
 * wrapped, and because every test needs its own client — a shared one leaks
 * cache between cases.
 */

/**
 * Every mutation outcome, delivered from one place.
 *
 * The declaration stays local — a mutation states its own success sentence —
 * and the policy stays global. That split is the difference between a
 * convention and a habit: with `toast()` at call sites, some mutations toast,
 * some do not, wording drifts, and error toasts duplicate what a form already
 * shows inline.
 *
 * Error toasting needs no declaration because the failure always matters; it is
 * *suppression* that has to be asked for, by a form that will show the error
 * next to the field it belongs to.
 */
export const createNotifyingMutationCache = (
  messageForError: ErrorMessage,
  translate: TranslateKey,
) =>
  new MutationCache({
    onSuccess: (_data, _variables, _context, mutation) => {
      const success = mutation.meta?.success;

      /*
       * `meta.success` is a key since `D7.4` (ADR-0046 §7), so the one place
       * that delivers an outcome is also the one place that resolves it —
       * which is the whole of what the ADR-0043 follow-up asked for: the
       * field's type narrowed, and nothing about who reads `meta` moved.
       */
      if (success !== undefined) toast.success(translate(success));
    },
    onError: (error, _variables, _context, mutation) => {
      if (mutation.meta?.errorToast === false) return;

      toast.error(messageForError(error));
    },
  });

/**
 * Queries are quieter than mutations by default.
 *
 * A failed read usually has somewhere better to show itself — an empty grid, an
 * error panel in the place the data would have been — and a background refetch
 * failing is not something to interrupt an operator over. So a query toasts
 * only when it asks to, which is the mirror of the mutation rule above and
 * deliberately not the same default.
 */
export const createNotifyingQueryCache = (messageForError: ErrorMessage) =>
  new QueryCache({
    onError: (error, query) => {
      if (query.meta?.errorToast !== true) return;

      toast.error(messageForError(error));
    },
  });

export interface QueryClientOptions {
  /**
   * How a failure becomes a sentence (ADR-0046 §2, `D7.2`).
   *
   * Passed in because this factory runs at the composition root, **before** the
   * i18next instance exists: the instance is created inside `SettingsProvider`,
   * where the account's locale is already known (`D7.1`). `app/index.tsx`
   * therefore hands a deferred lookup that a component under the provider binds
   * — see `createDeferredErrorMessage`.
   *
   * The default is the eagerly bundled English, which is what the app shows
   * anyway in the window before the provider mounts, and what a test that
   * builds its own client gets.
   */
  readonly messageForError?: ErrorMessage;
  /**
   * How a mutation's `meta.success` key becomes a sentence (`D7.4`).
   *
   * The sibling of `messageForError` and deferred for the identical reason:
   * this factory runs at the composition root, before the i18next instance
   * exists. The default is the eagerly bundled English catalogue, which is what
   * the app would show anyway in the window before the provider mounts.
   */
  readonly translate?: TranslateKey;
}

export const createQueryClient = ({
  messageForError = englishMessageForError,
  translate = englishTranslation,
}: QueryClientOptions = {}): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        /*
         * The library default of `0` marks everything stale immediately, so
         * every window focus and every remount refetches. That buys nothing on
         * admin CRUD that mostly changes because *this* operator changed it —
         * and mutations invalidate explicitly. Thirty seconds of tolerated
         * staleness is the same judgement ADR-0014 made server-side when it let
         * `total` come from a second, non-transactional query.
         */
        staleTime: 30_000,
        /*
         * A 4xx is an *answer* — the server parsed the request and refused
         * it — not a flake. Retrying a `403` three times triples load and
         * delays the real feedback. Transport failures (`status: 0`) and 5xx
         * are worth two more tries.
         *
         * Discriminating on **status** rather than on `isApiClientError` is
         * load-bearing: ADR-0033 guarantees *every* rejection out of the client
         * satisfies that predicate, including a dead socket, so branching on it
         * would make the whole rule dead code and retry nothing. ADR-0034's own
         * snippet has that bug — it predates ADR-0033's D3.4 amendment —
         * and is amended.
         */
        retry: (failureCount, error) =>
          isApiClientError(error) && error.status >= 400 && error.status < 500
            ? false
            : failureCount < 2,
      },
      /*
       * A write whose response was lost may already have been applied, so
       * replaying it automatically risks doing the thing twice. The operator
       * retries deliberately, from the error toast.
       */
      mutations: { retry: false },
    },
    mutationCache: createNotifyingMutationCache(messageForError, translate),
    queryCache: createNotifyingQueryCache(messageForError),
  });
