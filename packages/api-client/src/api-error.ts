import type { ErrorCode, ErrorDetail } from "@repo/contracts";

/**
 * The one failure type every call out of this client rejects with (ADR-0033
 * §Response translation) — the browser-side mirror of ADR-0013's `AppError`.
 *
 * Branded and functional for ADR-0013's own reason, which is *stronger* in a
 * bundled SPA than it was on the server: `instanceof` across chunk and library
 * boundaries is exactly where identity checks break, so callers branch on
 * {@link isApiClientError} and switch on `code`, never on a class and never on
 * a message string.
 *
 * The name is deliberately not `ApiError`. `@repo/contracts` already exports
 * that — the envelope's `error` object, which this module's sibling imports
 * while parsing — and a second type of the same name would guarantee import
 * confusion in every file that touches both.
 *
 * **Every** rejection satisfies this, including failures that carry no envelope
 * at all: the network is down, a gateway answered HTML, the request was
 * aborted. Callers get one failure type or the abstraction is not one.
 */

const API_CLIENT_ERROR = Symbol.for("machxi.apiClientError");

export interface ApiClientErrorData {
  /** The HTTP status that carried it, or `0` when no response arrived. */
  readonly status: number;
  /** The `@repo/contracts` union — the contract, where `message` is not. */
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: readonly ErrorDetail[];
}

export type ApiClientError = Error &
  Readonly<ApiClientErrorData> & { readonly [API_CLIENT_ERROR]: true };

export const apiClientError = (data: ApiClientErrorData): ApiClientError =>
  Object.assign(new Error(data.message), data, {
    [API_CLIENT_ERROR]: true,
  } as const) as ApiClientError;

export const isApiClientError = (error: unknown): error is ApiClientError =>
  typeof error === "object" && error !== null && API_CLIENT_ERROR in error;

/**
 * The code carried by a failure that never reached the envelope layer.
 *
 * ADR-0033 §Consequences left the exact value to this step under one
 * invariant — whatever it is, the rejection must satisfy `isApiClientError`,
 * or callers grow the second failure branch the abstraction exists to prevent.
 *
 * `SERVICE_UNAVAILABLE` is the honest choice from the existing union rather
 * than a new code: from the browser's side a dead socket, a DNS failure and a
 * proxy returning HTML are indistinguishable from an API that is not there,
 * which is what the code already means. Inventing a client-only member of a
 * union that `@repo/contracts` defines for the *API's* answers would make the
 * union describe two different things.
 */
export const TRANSPORT_ERROR_CODE = "SERVICE_UNAVAILABLE" satisfies ErrorCode;
