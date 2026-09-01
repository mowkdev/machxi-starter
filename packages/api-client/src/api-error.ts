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

/**
 * The generic code for a status family — ADR-0013's table read backwards.
 *
 * Seven of the nine are transcriptions: ADR-0013 assigns exactly one
 * `GENERIC_ERROR_CODES` member to that status, and `core/errors`' own factory
 * test pins the same pairs on the server side. **Two are choices**, because
 * ADR-0013 gives those statuses two codes each, and the entry says which
 * reading a client should assume when it cannot tell:
 *
 * - `400` → `VALIDATION_ERROR` rather than `MALFORMED_JSON`: a body this
 *   client sent and the server parsed is the overwhelmingly likelier `400`,
 *   and it is the code an operator's catalogue answers usefully. It is also
 *   the consequential pick, which is why `client.ts` refuses to carry a
 *   degraded failure's `details` — see the note there.
 * - `404` → `NOT_FOUND` rather than `ROUTE_NOT_FOUND`: the client asked for a
 *   resource, not for a route, and `ROUTE_NOT_FOUND` would tell an operator
 *   their address is wrong when what is missing is the record.
 */
const GENERIC_CODE_BY_STATUS: Readonly<Record<number, ErrorCode>> = {
  400: "VALIDATION_ERROR",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
  503: "SERVICE_UNAVAILABLE",
};

/**
 * What a code this build has never heard of becomes (`D13.1`, ADR-0057
 * §Consequences).
 *
 * `@repo/contracts` states the rule where it defines the union: adding a code
 * is additive (ADR-0015), so "clients must treat an unrecognised code as a
 * generic failure of whatever HTTP status carried it". This is that sentence
 * as a function, and it is deliberately **not** {@link TRANSPORT_ERROR_CODE}:
 * the response arrived, parsed, and refused the request for a reason the
 * server was clear about — reporting it as an unreachable service tells the
 * operator to check a connection that is fine, and hides a refusal they could
 * have acted on.
 *
 * The fallback is `INTERNAL_ERROR` rather than a wrong specific: a status
 * ADR-0013's table does not list has reached us inside a well-formed envelope,
 * and "something went wrong on our side" is the only thing that is true about
 * it. `500` is in the map rather than left to the fallback on purpose — it is
 * a status the API very much does use, and leaving it right by accident is a
 * worse comment than stating it.
 */
export const genericCodeForStatus = (status: number): ErrorCode =>
  GENERIC_CODE_BY_STATUS[status] ?? "INTERNAL_ERROR";

/**
 * A failure, turned into the sentence an operator reads (`D9.5`, ADR-0043
 * §Notifications, carrying ADR-0034's).
 *
 * **The type is here and the catalogue is not**, which is the whole of the
 * split: producing the sentence needs an app's `errors` namespace and belongs
 * to that app (ADR-0046 §13), while *asking* for one is what every consumer of
 * this client does — the toast handlers, the bulk-outcome summariser and
 * `@repo/form`'s `applyServerErrors` alike. `unknown` rather than
 * {@link ApiClientError} because a thrown value is unknown until
 * {@link isApiClientError} has looked at it, and a lookup that refused
 * everything else would push that branch onto every caller.
 *
 * It lives beside the error it is usually asked about so that the two packages
 * that need it — this one's consumers and `@repo/form` — share one definition
 * rather than two structurally-identical aliases that can drift in intent.
 */
export type ErrorMessage = (error: unknown) => string;
