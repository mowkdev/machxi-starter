/**
 * The door onto the bounded bulk fan-out (`D9.6`, ADR-0051).
 *
 * `D9.1` left this file behind because it imported `ErrorMessage` from
 * `shared/notifications`; `D9.5` moved that type to `@repo/api-client`, which
 * is where the fan-out's other dependency — `isApiClientError` — already was.
 * It is api-client's rather than the grid's because nothing in it knows a grid
 * exists: it runs N actions with a concurrency bound and reports per-item
 * outcomes (ADR-0038, ADR-0020).
 */
export {
  BULK_CONCURRENCY,
  runBulkAction,
  type BulkRefusal,
  type BulkOutcome,
  type BulkTarget,
} from "@repo/api-client";
