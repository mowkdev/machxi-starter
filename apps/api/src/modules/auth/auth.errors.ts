import {
  conflict,
  forbidden,
  unauthenticated,
  type AppError,
} from "../../core/errors/index.js";

/**
 * The auth module's error factories (ADR-0013).
 *
 * Thin wrappers over the generic ones: they fix the `code` and the message and
 * inherit the status, so there is no new error type and no `instanceof` check
 * anywhere. What the client branches on is the code — the table in
 * `@repo/contracts` says what each one means and what a client should do next.
 */

/**
 * Unknown email **or** wrong password, deliberately indistinguishable
 * (ADR-0018 §Login step 3). One message, one code, one status: anything that
 * differs between the two cases is an account-existence oracle.
 */
export const invalidCredentials = (): AppError =>
  unauthenticated("Invalid email or password", "AUTH_INVALID_CREDENTIALS");

/**
 * Credentials were correct but the account is not `active` (403).
 *
 * Raised only **after** the password verified, which is what keeps it from
 * telling an anonymous caller that an address exists.
 */
export const accountDisabled = (): AppError =>
  forbidden("This account is not active", "AUTH_ACCOUNT_DISABLED");

/** Missing, malformed, wrongly signed, or carrying the other population's `aud`. */
export const tokenInvalid = (): AppError =>
  unauthenticated("Invalid access token", "AUTH_TOKEN_INVALID");

/** Past `exp`, everything else valid — the client should refresh and retry. */
export const tokenExpired = (): AppError =>
  unauthenticated("Access token expired", "AUTH_TOKEN_EXPIRED");

/**
 * The token verifies but its session no longer does: logged out here or
 * elsewhere, revoked by an admin, or past the refresh token's expiry.
 */
export const sessionRevoked = (): AppError =>
  unauthenticated("Session is no longer valid", "AUTH_SESSION_REVOKED");

/** The refresh token is unknown, expired, or belongs to the other population. */
export const invalidRefreshToken = (): AppError =>
  unauthenticated("Invalid refresh token", "AUTH_INVALID_REFRESH_TOKEN");

/**
 * A rotated refresh token was replayed outside the grace window. The session
 * is revoked before this is thrown (ADR-0018 §Refresh step 4) — the token is
 * assumed stolen, and the client should re-login and be warned.
 */
export const refreshReused = (): AppError =>
  unauthenticated(
    "Refresh token was already used; the session has been revoked",
    "AUTH_REFRESH_REUSED",
  );

/**
 * A registration whose email is already taken.
 *
 * Plain `CONFLICT`, never `USER_EMAIL_TAKEN`: this endpoint is anonymous, and
 * a code that names the conflict turns it into an account-existence oracle
 * (ADR-0020 §Enumeration). `USER_EMAIL_TAKEN` is reserved for the
 * authenticated `POST /api/v1/admin/users`, where the caller is staff and may
 * be told exactly what went wrong.
 */
export const registrationConflict = (): AppError =>
  conflict("Registration could not be completed");
