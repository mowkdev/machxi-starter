import {
  createQueryClient as createQueryClientBase,
  type QueryClientOptions,
} from "@repo/app-kit";
import type { QueryClient } from "@tanstack/react-query";

import { englishTranslation } from "@/shared/i18n";
import { englishMessageForError } from "@/shared/notifications/messages";

/**
 * The query-client door (ADR-0034, ADR-0062 §1).
 *
 * `@repo/app-kit` owns the client: ADR-0034's retry policy, its `staleTime`,
 * the two notifying caches and the `meta` augmentation that types them. What
 * this file adds is the pair of app-owned defaults the kit deliberately
 * requires — the error map, which reads *this* app's `errors` catalogue, and
 * the outcome translator, which resolves *this* app's `meta.success` keys.
 *
 * They are defaults rather than arguments because a client is built before an
 * i18next instance exists (`app/index.tsx` builds one at module scope) and
 * again inside a suite that has one. `app/index.tsx` passes the deferred pair
 * of ADR-0046 §2; everything else takes the English fallbacks.
 */
export const createQueryClient = (
  options: Partial<QueryClientOptions> = {},
): QueryClient =>
  createQueryClientBase({
    messageForError: englishMessageForError,
    translate: englishTranslation,
    ...options,
  });

export type { QueryClientOptions };
