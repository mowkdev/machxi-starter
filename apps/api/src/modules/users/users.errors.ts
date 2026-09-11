import { conflict, notFound, type AppError } from "../../core/errors/index.js";

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
 * A write aimed at a soft-deleted account (ADR-0028).
 *
 * `409` and not `404`: the account exists and the caller may still read it —
 * `GET /:id` answers `200` for a deleted account on purpose, because an admin
 * who can list deleted accounts must be able to open one. What the request
 * conflicts with is the state of the row, which is the same distinction
 * {@link lastSuperAdmin} draws in the staff module.
 */
export const userDeleted = (): AppError =>
  conflict("This account has been deleted", "USER_DELETED");

/**
 * `POST /api/v1/user/profile/password/set-link` from an account that already
 * has a password (ADR-0072 §3, amended after `D19.4`).
 *
 * The generic `CONFLICT` and no code of its own: the security section never
 * offers the control to such an account, so a client meets this only from a
 * stale screen, and what it conflicts with is the row's state — change the
 * password with the current one instead.
 */
export const passwordAlreadySet = (): AppError =>
  conflict(
    "This account already has a password; change it with the current one",
  );
