import type {
  ApiError,
  ErrorEnvelope,
  ListEnvelope,
  Meta,
  Page,
  SuccessEnvelope,
} from "@repo/contracts";

/**
 * Builders for the three response shapes (ADR-0012).
 *
 * Pure functions of a request id and a payload, so envelope conformance can be
 * unit-tested without an HTTP server. `respond.*` is what controllers use;
 * these are what it calls.
 */

/** `{ success: true, data, meta }` — a single resource or object. */
export const successEnvelope = <T>(
  requestId: string,
  data: T,
): SuccessEnvelope<T> => ({ success: true, data, meta: { requestId } });

/**
 * `{ success: true, data: [...], meta }` — a collection.
 *
 * `meta` echoes the **resolved** query (defaults applied), which is what lets a
 * client render its table state from the response alone (ADR-0014). `filters`
 * is omitted rather than sent empty when nothing was filtered, so the key's
 * presence means something.
 */
export const listEnvelope = <T>(
  requestId: string,
  page: Page<T>,
): ListEnvelope<T> => {
  const meta: Meta & { pagination: NonNullable<Meta["pagination"]> } = {
    requestId,
    pagination: { offset: page.offset, limit: page.limit, total: page.total },
    sort: page.sort,
    ...(Object.keys(page.filters).length === 0
      ? {}
      : { filters: page.filters }),
  };

  return { success: true, data: page.items, meta };
};

/**
 * `{ success: false, error, meta }`.
 *
 * Produced exclusively by the error middleware (ADR-0013) — a controller never
 * builds one, it throws.
 */
export const errorEnvelope = (
  requestId: string,
  error: ApiError,
): ErrorEnvelope => ({ success: false, error, meta: { requestId } });
