import {
  conflict,
  forbidden,
  notFound,
  type AppError,
} from "../../core/errors/index.js";

/**
 * The users module's error factories (ADR-0013).
 *
 * Thin wrappers over the generic ones: they fix the `code` and the message and
 * inherit the status, so there is no new error type and no `instanceof` check
 * anywhere.
 */

/** No user account with that id. */
export const userNotFound = (): AppError => notFound("User not found");

/**
 * `POST /api/v1/admin/users` with an address the `users` table already holds.
 *
 * It may name the conflict because the caller is authenticated staff who can
 * already list every user address. The anonymous `POST /public/auth/register`
 * must not, and answers a plain `CONFLICT` instead (ADR-0020 §Enumeration).
 */
export const userEmailTaken = (): AppError =>
  conflict("A user with this email already exists", "USER_EMAIL_TAKEN");

/**
 * `POST /api/v1/user/profile/change-password` where `currentPassword` does not
 * verify.
 *
 * `403`, not `401`: the caller's session is valid and stays valid, so a `401`
 * would be untrue about the request and would send every client interceptor
 * that reads `401` as "the session died" to the login screen over a typo.
 */
export const currentPasswordInvalid = (): AppError =>
  forbidden(
    "The current password is incorrect",
    "USER_CURRENT_PASSWORD_INVALID",
  );
