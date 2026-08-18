import type { ApiError, ErrorDetail } from "@repo/contracts";
import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

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

/** `body-parser` failure types, surfaced through `express.json()`. */
const JSON_PARSE_FAILED = "entity.parse.failed";
const ENTITY_TOO_LARGE = "entity.too.large";

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

  switch (errorType(error)) {
    case JSON_PARSE_FAILED:
      return malformedJson();
    case ENTITY_TOO_LARGE:
      return payloadTooLarge();
    default:
      break;
  }

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
  /**
   * Adds `error.debug` (name, message, stack) to non-exposed responses.
   * Development only — ADR-0013 forbids it in test and production, where a
   * stack in a response body is an information leak, not a convenience.
   */
  readonly includeDebug: boolean;
}

export const createErrorHandler = ({
  includeDebug,
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
    const logger = req.ctx.logger;

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

    sendErrorEnvelope(res, appError.status, req.ctx.requestId, body);
  };
};
