import type {
  ErrorCode,
  ErrorDetail,
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
 *
 * **`listOk` came back at `D15.5`**, which is the line above being spent
 * rather than revised: it said a list-envelope builder would be inventory
 * without a consumer and would return with the first list. The first list is
 * not the grid ADR-0055 §3 was talking about — it is an organization's members
 * and its pending invitations, two `respond.list` endpoints read by two plain
 * tables (ADR-0067 §6). The envelope is the same one either way, which is the
 * point of there being one.
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

/**
 * A list response, the way `respond.list` builds one (ADR-0012, ADR-0014).
 *
 * All three `meta` members and not only `pagination`: the API fills `sort` and
 * `filters` on every list response and the client reads them back rather than
 * recomputing them, so a handler that emitted one of the three would describe
 * an API that does not exist — the load-bearing rule of ADR-0036 applied to the
 * envelope rather than to the body.
 */
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
        sort: [...page.sort],
        filters: page.filters,
      },
    },
    { status },
  );
