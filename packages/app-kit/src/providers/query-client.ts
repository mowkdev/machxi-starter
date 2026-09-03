import { isApiClientError, type ErrorMessage } from "@repo/api-client";
import type { TranslateKey, TranslationKey } from "@repo/i18n";
import { toast } from "@repo/ui/components/sonner";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

/**
 * The one query client both SPAs run on (ADR-0034), extracted at `D14.8`
 * (ADR-0062 §1).
 *
 * It was two byte-identical files — `apps/admin/src/app/providers/query-client.ts`
 * and its twin one app over — differing in nothing but the comment above them.
 * What made them app code was three values, and all three are parameters here:
 * the error map, the outcome translator and the `meta` shape below.
 *
 * **The `meta` augmentation lives with the client rather than beside it.**
 * Both apps carried a `shared/api/query-meta.ts` whose whole content was this
 * `declare module`, imported for its side effect by the file that reads
 * `mutation.meta`. Declaration merging is global to a TypeScript program, so
 * the augmentation is in force for a consuming app the moment this module is
 * in its graph — which it is, because the app builds its client from here.
 * `TranslationKey` resolves over whatever catalogues that program declares
 * (ADR-0046 §13), so the key stays the app's and the shape stays one file.
 */
declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      /** The success sentence, as a key — resolved when the toast is raised. */
      readonly success?: TranslationKey;
      /** Opt a mutation out of the global error toast (ADR-0034). */
      readonly errorToast?: boolean;
    };
    queryMeta: {
      /** Opt a query *into* one: queries are silent by default. */
      readonly errorToast?: true;
    };
  }
}

/**
 * ADR-0034's global mutation feedback: every mutation that names a sentence
 * gets a success toast, and every failure gets one unless it says otherwise.
 */
export const createNotifyingMutationCache = (
  messageForError: ErrorMessage,
  translate: TranslateKey,
): MutationCache =>
  new MutationCache({
    onSuccess: (_data, _variables, _context, mutation) => {
      const success = mutation.meta?.success;

      if (success !== undefined) toast.success(translate(success));
    },
    onError: (error, _variables, _context, mutation) => {
      if (mutation.meta?.errorToast === false) return;

      toast.error(messageForError(error));
    },
  });

/** The mirror image for queries: silent unless the query opts in. */
export const createNotifyingQueryCache = (
  messageForError: ErrorMessage,
): QueryCache =>
  new QueryCache({
    onError: (error, query) => {
      if (query.meta?.errorToast !== true) return;

      toast.error(messageForError(error));
    },
  });

export interface QueryClientOptions {
  /**
   * How an unknown thrown value becomes a sentence. The app's, because the
   * catalogue it reads is the app's (ADR-0046 §2).
   */
  readonly messageForError: ErrorMessage;
  /** How a `meta.success` key becomes a sentence, likewise. */
  readonly translate: TranslateKey;
}

/**
 * `retry` on a 4xx would be a second refusal, so it is not attempted; anything
 * else gets two tries. `staleTime` is ADR-0034's 30 seconds.
 */
export const createQueryClient = ({
  messageForError,
  translate,
}: QueryClientOptions): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) =>
          isApiClientError(error) && error.status >= 400 && error.status < 500
            ? false
            : failureCount < 2,
      },
      mutations: { retry: false },
    },
    mutationCache: createNotifyingMutationCache(messageForError, translate),
    queryCache: createNotifyingQueryCache(messageForError),
  });
