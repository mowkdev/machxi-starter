import type { ErrorDetail } from "@repo/contracts";
import type { ZodIssue } from "zod";

import { validation } from "./errors.js";
import type { AppError } from "./app-error.js";

/**
 * zod issues → the `details` array of a `VALIDATION_ERROR` (ADR-0013).
 *
 * Takes the issues rather than the `ZodError` so that a caller which collected
 * issues from several schemas — `validate()` parses params, query and body —
 * can report them in one response without assembling a synthetic error object.
 *
 * `path` is the dotted path into the offending object exactly as the client
 * sent it (`"email"`, `"filter.status"`, `"roles.0"`), so a form can attach the
 * message to the right field. It is omitted when the issue is about the object
 * as a whole.
 */
export const toErrorDetails = (issues: readonly ZodIssue[]): ErrorDetail[] =>
  issues.map((issue): ErrorDetail => {
    const path = issue.path.join(".");

    return {
      ...(path === "" ? {} : { path }),
      message: issue.message,
      code: issue.code,
    };
  });

/** The `AppError` a failed validation produces. */
export const toValidationError = (issues: readonly ZodIssue[]): AppError =>
  validation("Request validation failed", toErrorDetails(issues));
