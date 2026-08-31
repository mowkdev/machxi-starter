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
 * The query client and its notification policy (`D12.6`; ADR-0034 as carried by
 * ADR-0043).
 *
 * A `create*` wrapper because ADR-0009 says third-party constructors are
 * wrapped, and because every test needs its own client — a shared one leaks
 * cache between cases.
 *
 * **This is the admin's file with no line of its own**, and that is worth
 * stating rather than glossing: the policy — one delivery point for outcomes,
 * silent queries, no retry on a 4xx, no retry on a mutation — is ADR-0034's and
 * belongs to neither app. It is copied rather than extracted for the reason the
 * envelope builders were (the plan's finding 4): the deliverable's rule is that
 * a package diff is named before it is made, and there is no home for this
 * short of a decision. It is recorded as finding 8.
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

      // `meta.success` is a key (ADR-0046 §7), so the one place that delivers
      // an outcome is also the one place that resolves it.
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
 * A failed read usually has somewhere better to show itself — an error panel in
 * the place the data would have been — and a background refetch failing is not
 * something to interrupt a customer over. So a query toasts only when it asks
 * to, which is the mirror of the mutation rule above and deliberately not the
 * same default.
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
   * How a failure becomes a sentence (ADR-0046 §2).
   *
   * Passed in because this factory runs at the composition root, **before** the
   * i18next instance exists: the instance is created inside the session gate,
   * in `I18nProvider`. `app/index.tsx` therefore hands a deferred lookup that a
   * component under the provider binds — see `createDeferredErrorMessage`.
   *
   * The default is the eagerly bundled English, which is what the app shows
   * anyway in the window before the provider mounts, and what a test that
   * builds its own client gets.
   */
  readonly messageForError?: ErrorMessage;
  /**
   * How a mutation's `meta.success` key becomes a sentence.
   *
   * The sibling of `messageForError` and deferred for the identical reason.
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
         * an account screen that mostly changes because *this* customer changed
         * it — and mutations invalidate explicitly.
         */
        staleTime: 30_000,
        /*
         * A 4xx is an *answer* — the server parsed the request and refused it —
         * not a flake. Retrying a `403` three times triples load and delays the
         * real feedback. Transport failures (`status: 0`) and 5xx are worth two
         * more tries.
         *
         * Discriminating on **status** rather than on `isApiClientError` is
         * load-bearing: ADR-0033 guarantees *every* rejection out of the client
         * satisfies that predicate, including a dead socket, so branching on it
         * would make the whole rule dead code and retry nothing.
         */
        retry: (failureCount, error) =>
          isApiClientError(error) && error.status >= 400 && error.status < 500
            ? false
            : failureCount < 2,
      },
      /*
       * A write whose response was lost may already have been applied, so
       * replaying it automatically risks doing the thing twice. The customer
       * retries deliberately, from the error toast.
       */
      mutations: { retry: false },
    },
    mutationCache: createNotifyingMutationCache(messageForError, translate),
    queryCache: createNotifyingQueryCache(messageForError),
  });
