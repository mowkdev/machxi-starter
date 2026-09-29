import { apiClientError, type ApiClientError } from "@repo/api-client";
import type { ErrorCode, ErrorDetail } from "@repo/contracts";

/**
 * What the two profile suites stand an app's profile entity in with (`D22.2`,
 * ADR-0077 §4, ADR-0036).
 *
 * An app binds the forms to its own entity's mutations, which go through the
 * client to an endpoint on that app's segment. Neither is this package's, so
 * here the mutation is a function the test holds: it records what the form
 * handed it, and it settles when and how the test says. The refusals are the
 * client's own failure type, built with the client's own factory, so what the
 * forms branch on is the real thing.
 */

/** A rejection as the ADR-0033 client would have produced it. */
export const refusal = (
  status: number,
  code: ErrorCode,
  details?: readonly ErrorDetail[],
): ApiClientError =>
  apiClientError({
    status,
    code,
    // The API's developer-facing English, which no form may show for a code.
    message: `wire: ${code}`,
    ...(details === undefined ? {} : { details }),
  });

/**
 * A write that is still in flight, and stays so: the request a lock is
 * asserted against must not settle before the assertion, or the case passes
 * on a form that never locked at all.
 */
export const neverSettles = <T,>(): Promise<T> =>
  new Promise<T>(() => undefined);
