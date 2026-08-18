import type { ErrorCode, ErrorDetail } from "@repo/contracts";

import { appError, type AppError } from "./app-error.js";

/**
 * The generic error factories — one per status family (ADR-0013).
 *
 * A module that needs a more specific code writes a thin factory over one of
 * these in its own `<module>.errors.ts`, keeping the status and fixing the
 * code:
 *
 * ```ts
 * export const invalidCredentials = () =>
 *   unauthenticated("Invalid email or password", "AUTH_INVALID_CREDENTIALS");
 * ```
 *
 * Services throw these; controllers never catch them; the error middleware is
 * the only place that turns one into a response.
 */

export const validation = (
  message = "Request validation failed",
  details?: readonly ErrorDetail[],
): AppError =>
  appError({
    status: 400,
    code: "VALIDATION_ERROR",
    message,
    ...(details === undefined ? {} : { details }),
  });

export const malformedJson = (message = "Malformed JSON body"): AppError =>
  appError({ status: 400, code: "MALFORMED_JSON", message });

export const unauthenticated = (
  message = "Unauthenticated",
  code: ErrorCode = "UNAUTHENTICATED",
): AppError => appError({ status: 401, code, message });

export const forbidden = (
  message = "Forbidden",
  code: ErrorCode = "FORBIDDEN",
): AppError => appError({ status: 403, code, message });

export const notFound = (
  message = "Not found",
  code: ErrorCode = "NOT_FOUND",
): AppError => appError({ status: 404, code, message });

export const conflict = (
  message = "Conflict",
  code: ErrorCode = "CONFLICT",
): AppError => appError({ status: 409, code, message });

export const payloadTooLarge = (
  message = "Request body is too large",
): AppError => appError({ status: 413, code: "PAYLOAD_TOO_LARGE", message });

/**
 * `429` with the wait in `details`. The `Retry-After` header itself is set by
 * the rate limiter (ADR-0020); this carries the same number in the envelope so
 * a client that only parses the body can still back off correctly.
 */
export const rateLimited = (retryAfterSec: number): AppError =>
  appError({
    status: 429,
    code: "RATE_LIMITED",
    message: "Too many requests",
    details: [{ code: "retryAfter", message: String(retryAfterSec) }],
  });

/**
 * The catch-all `500`. `expose: false` keeps whatever the cause said out of the
 * response — the client gets "Internal server error" and the `requestId` it
 * needs to ask an operator, who has the full `err` in the log line.
 */
export const internal = (cause?: unknown): AppError =>
  appError({
    status: 500,
    code: "INTERNAL_ERROR",
    message: "Internal server error",
    expose: false,
    ...(cause === undefined ? {} : { cause }),
  });

/**
 * `503`, raised by readiness when a dependency is down (ADR-0016). `details`
 * names the failing indicator; its message must already be sanitised — no
 * host, DSN or credential ever reaches it.
 */
export const unavailable = (details?: readonly ErrorDetail[]): AppError =>
  appError({
    status: 503,
    code: "SERVICE_UNAVAILABLE",
    message: "Service unavailable",
    ...(details === undefined ? {} : { details }),
  });
