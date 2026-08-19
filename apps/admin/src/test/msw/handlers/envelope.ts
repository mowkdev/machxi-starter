import type {
  ErrorCode,
  ErrorEnvelope,
  ListEnvelope,
  Page,
  SuccessEnvelope,
} from "@repo/contracts";
import { HttpResponse } from "msw";

/**
 * Envelope builders, typed against `@repo/contracts` (ADR-0036 §The
 * load-bearing rule).
 *
 * The honesty half of the MSW decision: a handler that builds a response by
 * object literal decays into describing the API the frontend wishes it had.
 * Going through these means a contract change stops the suite compiling
 * instead of letting it certify against a fiction — which is a rule, not a
 * convention, and applies to a handler that passes.
 *
 * `meta.requestId` is a fixed value rather than a random one: ADR-0026 wants
 * the suite to be a pure function of the tree, and nothing asserts on it.
 */

const REQUEST_ID = "00000000-0000-7000-8000-000000000000";

export const ok = <T>(data: T, status = 200) =>
  HttpResponse.json<SuccessEnvelope<T>>(
    { success: true, data, meta: { requestId: REQUEST_ID } },
    { status },
  );

export const listOk = <T>(page: Page<T>, status = 200) =>
  HttpResponse.json<ListEnvelope<T>>(
    {
      success: true,
      data: [...page.items],
      meta: {
        requestId: REQUEST_ID,
        pagination: {
          offset: page.offset,
          limit: page.limit,
          total: page.total,
        },
        // `respond.list` fills all three on every list response, so a handler
        // that emitted only `pagination` would describe an API that does not
        // exist — and the client reads `meta.sort` / `meta.filters` rather
        // than recomputing them (ADR-0012, ADR-0014).
        sort: [...page.sort],
        filters: page.filters,
      },
    },
    { status },
  );

export const fail = (status: number, code: ErrorCode, message?: string) =>
  HttpResponse.json<ErrorEnvelope>(
    {
      success: false,
      error: { code, message: message ?? code },
      meta: { requestId: REQUEST_ID },
    },
    { status },
  );
