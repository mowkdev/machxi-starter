import type { ErrorCode } from "@repo/contracts";

import { isApiClientError } from "@/shared/api/api-error";

/**
 * One message per error code (ADR-0034 §Notifications).
 *
 * `Record<ErrorCode, string>` is the point of the file, not a formality: it
 * makes the compiler enforce what ADR-0013 designed the union for. A code added
 * to `@repo/contracts` fails this build until someone writes a sentence for it,
 * so an operator can never meet a new failure as a raw `SCREAMING_SNAKE` string
 * — the gap is a red build instead of a bad screen.
 *
 * This is also the i18n seam. Codes are the catalogue key and these strings are
 * the default catalogue; swapping this map for a locale-aware lookup later
 * changes one file, which is why nothing anywhere else hard-codes a failure
 * sentence.
 *
 * The wording is for an operator, not a developer: it says what happened and,
 * where there is one, what to do. The API's own `message` is a developer-facing
 * English default (ADR-0013) and is deliberately not shown.
 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR:
    "Some of the details are not valid. Check the form and try again.",
  MALFORMED_JSON: "That request could not be read. Try again.",
  PAYLOAD_TOO_LARGE: "That is too large to send.",
  UNAUTHENTICATED: "Your session has ended. Sign in again.",
  FORBIDDEN: "You do not have permission to do that.",
  NOT_FOUND: "That no longer exists. It may have been deleted.",
  ROUTE_NOT_FOUND: "That address does not exist.",
  CONFLICT: "That conflicts with something that already exists.",
  RATE_LIMITED: "Too many attempts. Wait a moment and try again.",
  INTERNAL_ERROR: "Something went wrong on the server. Try again.",
  SERVICE_UNAVAILABLE:
    "The API could not be reached. Check your connection and try again.",

  AUTH_INVALID_CREDENTIALS: "That email and password do not match an account.",
  AUTH_TOKEN_INVALID: "Your session is no longer valid. Sign in again.",
  AUTH_TOKEN_EXPIRED: "Your session expired. Sign in again.",
  AUTH_SESSION_REVOKED: "This session was signed out. Sign in again.",
  AUTH_INVALID_REFRESH_TOKEN:
    "Your session could not be renewed. Sign in again.",
  AUTH_REFRESH_REUSED:
    "Your session was ended for security reasons. Sign in again.",
  AUTH_ACCOUNT_DISABLED: "This account is disabled. Ask an administrator.",
  AUTH_CURRENT_PASSWORD_INVALID: "That is not your current password.",
  CSRF_TOKEN_INVALID: "That request could not be verified. Try again.",

  USER_EMAIL_TAKEN: "Another user already uses that email address.",
  USER_DELETED: "That user is deleted and cannot be changed.",
  STAFF_EMAIL_TAKEN: "Another staff member already uses that email address.",
  STAFF_LAST_SUPER_ADMIN:
    "This is the last super admin. Promote someone else first.",
};

const FALLBACK = "Something went wrong. Try again.";

/**
 * The sentence to show for a failure.
 *
 * The runtime fallback is not dead code guarded by the compiler above: an older
 * bundle can meet a newer API, and a code this build has never heard of is
 * exactly what `@repo/contracts` tells clients to degrade on. Falling back to a
 * generic message of the right severity is that instruction followed.
 */
export const messageForError = (error: unknown): string => {
  if (!isApiClientError(error)) return FALLBACK;

  return ERROR_MESSAGES[error.code] ?? FALLBACK;
};
