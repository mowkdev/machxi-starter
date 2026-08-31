import type {
  ErrorCode,
  ErrorDetail,
  ErrorEnvelope,
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
 *
 * **`listOk` is absent**, unlike the admin's copy: ADR-0055 §3 mounts no grid
 * until a domain entity arrives, so nothing in this app reads a list envelope
 * and a builder for one would be inventory without a consumer. It comes back
 * with the first list.
 *
 * That this file is otherwise the admin's twin is recorded as a finding in
 * `docs/plan/0012-customer-app.md` §Findings: it holds no app knowledge at all,
 * only `@repo/contracts` types, and is the clearest candidate D12 has produced
 * for shared test support.
 */

const REQUEST_ID = "00000000-0000-7000-8000-000000000000";

export const ok = <T>(data: T, status = 200) =>
  HttpResponse.json<SuccessEnvelope<T>>(
    { success: true, data, meta: { requestId: REQUEST_ID } },
    { status },
  );

/**
 * `details` is the half a form test cannot do without: ADR-0013 puts a zod
 * issue's field path there, and `applyServerErrors` is entirely about where
 * those paths land. A `fail` that could not carry them would let the suite
 * assert the form-level fallback and never the field-level path it exists to
 * take first.
 */
export const fail = (
  status: number,
  code: ErrorCode,
  message?: string,
  details?: readonly ErrorDetail[],
) =>
  HttpResponse.json<ErrorEnvelope>(
    {
      success: false,
      error: {
        code,
        message: message ?? code,
        ...(details === undefined ? {} : { details }),
      },
      meta: { requestId: REQUEST_ID },
    },
    { status },
  );
