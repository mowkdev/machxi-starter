import type { ErrorCode, ErrorDetail } from "@repo/contracts";

/**
 * The one error type of the API (ADR-0013).
 *
 * There is no subclass hierarchy: `AppError` is a plain `Error` carrying data,
 * and every "kind" of error is a **factory function** that produces one with a
 * different `code`. Code identifies errors by `code` and {@link isAppError},
 * never by `instanceof` — which is also what makes the check survive two
 * copies of this module in one process (bundled dependency, vitest module
 * graph), where `instanceof` silently returns `false`.
 */

/** Brand key. A symbol so no plain object can accidentally satisfy the guard. */
const APP_ERROR = Symbol.for("machxi.appError");

export interface AppErrorData {
  /** HTTP status the error middleware will send. */
  readonly status: number;
  /** Stable machine code the client branches on, and the future i18n key. */
  readonly code: ErrorCode;
  /** Developer-facing English default; not part of the contract. */
  readonly message: string;
  /** Field-level or structured hints — always safe to expose. */
  readonly details?: readonly ErrorDetail[];
  /**
   * Whether `message` may be sent to the client. Defaults to `true`; the 500
   * factory sets it to `false` so an internal message can be logged in full
   * and replaced on the wire (ADR-0013).
   */
  readonly expose?: boolean;
  /** The underlying failure, for the log line only. */
  readonly cause?: unknown;
}

export type AppError = Error &
  Readonly<AppErrorData> & { readonly [APP_ERROR]: true };

/**
 * Builds an {@link AppError}. Prefer the factories in `./errors.js` — this is
 * the primitive they share.
 */
export const appError = (data: AppErrorData): AppError => {
  const error = new Error(data.message, {
    ...(data.cause === undefined ? {} : { cause: data.cause }),
  });

  error.name = "AppError";

  return Object.assign(error, data, { [APP_ERROR]: true as const });
};

/** Narrows an unknown thrown value to an {@link AppError}. */
export const isAppError = (value: unknown): value is AppError =>
  typeof value === "object" && value !== null && APP_ERROR in value;

/**
 * Whether the error's `message` may be sent to the client. Defaults to `true`
 * so a factory has to opt *out* of exposing, never in.
 */
export const isExposed = (error: AppError): boolean => error.expose !== false;
