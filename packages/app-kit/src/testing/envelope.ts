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
 * **Moved here at `D20.10`** (ADR-0062 §1, the harness third of the review's
 * FE-04). It lived twice — `apps/admin/src/test/msw/handlers/envelope.ts` and
 * the copy `D15.5` made of it for `apps/customer` — and both copies' own
 * comments said so and named the promotion as owed. It qualifies on the rule
 * ADR-0062 §1 uses to decide the boundary rather than on the duplication:
 * there is no app in it at all. No segment, no route, no fixture, no
 * dictionary — only `@repo/contracts` types and `msw`, which is exactly what
 * a door cannot bind and therefore does not need to.
 */

const REQUEST_ID = "00000000-0000-7000-8000-000000000000";

export const ok = <T>(data: T, status = 200) =>
  HttpResponse.json<SuccessEnvelope<T>>(
    { success: true, data, meta: { requestId: REQUEST_ID } },
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
