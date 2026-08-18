import type { ApiError, ErrorDetail } from "@repo/contracts";
import type { Logger } from "@repo/logger";
import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

import type { RequestContext } from "../context/index.js";

import {
  appError,
  internal,
  isAppError,
  isExposed,
  malformedJson,
  payloadTooLarge,
  toValidationError,
  type AppError,
} from "../errors/index.js";
import { sendErrorEnvelope } from "../http/index.js";

/**
 * The single place an error becomes a response (ADR-0013), last in the chain.
 *
 * Everything that reaches here is mapped onto one `AppError` and rendered as
 * the error envelope. Nothing else in the code base writes an error body, so
 * the shape cannot drift between endpoints, and an unexpected failure cannot
 * leak a stack trace, a SQL fragment or a connection string to a client.
 */

/** Postgres `unique_violation` — the safety net for a constraint a repository did not translate. */
const PG_UNIQUE_VIOLATION = "23505";

/**
 * `body-parser` failure types, surfaced through `express.json()` and
 * `express.urlencoded()`.
 *
 * All of them are the client's doing, so all of them must map to a 4xx. Any
 * type left out of this table falls through to `internal()`, which means an
 * unauthenticated caller can drive the 5xx rate — and, in development, get a
 * stack trace back for what is really a bad request.
 *
 * The message is ours in every case: the library's own text is not echoed, so
 * the mapping cannot start leaking library internals if body-parser reworks it.
 */
const BODY_PARSER_ERRORS: Readonly<Record<string, () => AppError>> = {
  "entity.parse.failed": () => malformedJson(),
  "entity.verify.failed": () => malformedJson(),
  "entity.too.large": () => payloadTooLarge(),
  "parameters.too.many": () => payloadTooLarge("Too many body parameters"),
  "charset.unsupported": () => malformedJson("Unsupported body charset"),
  "encoding.unsupported": () => malformedJson("Unsupported body encoding"),
  "stream.encoding.set": () => malformedJson(),
  "stream.not.readable": () => malformedJson(),
  // The client hung up mid-body. Nothing can be delivered, and the write below
  // is a no-op; what matters is that it is not logged as a server failure.
  "request.aborted": () => malformedJson("Request aborted"),
};

const errorType = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "type" in error
    ? String((error as { type: unknown }).type)
    : undefined;

const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;

/**
 * Maps anything thrown into the one `AppError` that will be rendered.
 *
 * Exported so the mapping can be unit-tested without an HTTP round trip, and
 * so the table in ADR-0013 has a single implementation to check against.
 */
export const toAppError = (error: unknown): AppError => {
  if (isAppError(error)) return error;

  if (error instanceof ZodError) return toValidationError(error.issues);

  const type = errorType(error);
  const bodyParserError =
    type === undefined ? undefined : BODY_PARSER_ERRORS[type];

  if (bodyParserError !== undefined) return bodyParserError();

  // A unique violation that reached this far means no repository claimed it.
  // `CONFLICT` without naming the column: the constraint name would tell an
  // unauthenticated caller which value already exists (ADR-0020 §Enumeration).
  if (errorCode(error) === PG_UNIQUE_VIOLATION) {
    return appError({
      status: 409,
      code: "CONFLICT",
      message: "Conflict",
      cause: error,
    });
  }

  return internal(error);
};

export interface ErrorHandlerOptions {
  /** Used only when a request failed before it had a context (see below). */
  readonly logger: Logger;
  /**
   * Adds `error.debug` (name, message, stack) to non-exposed responses.
   * Development only — ADR-0013 forbids it in test and production, where a
   * stack in a response body is an information leak, not a convenience.
   */
  readonly includeDebug: boolean;
}

export const createErrorHandler = ({
  includeDebug,
  logger: fallbackLogger,
}: ErrorHandlerOptions): ErrorRequestHandler => {
  return (error, req, res, next) => {
    // Something already started writing the response; the only safe action is
    // Express's default handler, which destroys the socket.
    if (res.headersSent) {
      next(error);

      return;
    }

    const appError = toAppError(error);
    const exposed = isExposed(appError);

    // Defensive, although the context middleware is second in the chain: if
    // anything above it throws, `req.ctx` is absent and an unguarded read would
    // make *this* handler throw — at which point Express's `finalhandler`
    // answers with the raw stack. The one path that must never fail is the one
    // that exists to stop failures from leaking.
    const ctx = req.ctx as RequestContext | undefined;
    const logger = ctx?.logger ?? fallbackLogger;
    const requestId = ctx?.requestId ?? "unknown";

    if (appError.status >= 500) {
      // `err` so pino serialises the stack and the `cause` chain (ADR-0005).
      logger.error({ err: error, code: appError.code }, "request failed");
    } else {
      // No stack: a 4xx is the client's problem and its stack is this file.
      logger.warn(
        { code: appError.code, status: appError.status },
        "request rejected",
      );
    }

    const details: readonly ErrorDetail[] | undefined = appError.details;

    const body: ApiError = {
      code: appError.code,
      message: exposed ? appError.message : "Internal server error",
      ...(details === undefined || details.length === 0 ? {} : { details }),
      ...(includeDebug && !exposed && error instanceof Error
        ? {
            debug: {
              name: error.name,
              message: error.message,
              ...(error.stack === undefined ? {} : { stack: error.stack }),
            },
          }
        : {}),
    };

    sendErrorEnvelope(res, appError.status, requestId, body);
  };
};
