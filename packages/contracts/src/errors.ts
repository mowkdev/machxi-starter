/**
 * The error half of the response envelope (ADR-0012) and the stable machine
 * codes clients branch on (ADR-0013).
 *
 * **`code` is the contract; `message` is not.** `message` is a developer-facing
 * English default that may be reworded at any time. Clients switch on `code`
 * and, once i18n arrives, use it as the message-catalogue key.
 */

/**
 * Generic codes — one per status family, thrown by the shared error factories
 * in `core/errors` (ADR-0013).
 *
 * | Code | Status | Raised when |
 * |---|---|---|
 * | `VALIDATION_ERROR` | 400 | zod rejected params/query/body; `details` carries the field paths |
 * | `MALFORMED_JSON` | 400 | the body was not parseable JSON (`entity.parse.failed`) |
 * | `PAYLOAD_TOO_LARGE` | 413 | the body exceeded the configured JSON limit |
 * | `UNAUTHENTICATED` | 401 | no credentials were presented at all |
 * | `FORBIDDEN` | 403 | authenticated, but the principal lacks the required role |
 * | `NOT_FOUND` | 404 | the addressed resource does not exist |
 * | `ROUTE_NOT_FOUND` | 404 | no route matched the path at all (`notFoundHandler`) |
 * | `CONFLICT` | 409 | a constraint violation that must **not** name what conflicted, plus anything not mapped to a domain code |
 *
 * A token for the wrong population is `AUTH_TOKEN_INVALID`, not
 * `UNAUTHENTICATED`: ADR-0019 fixes the *status* at 401 so that the wrong
 * population cannot probe for route existence, and leaves the code to the
 * token-shaped failure that actually occurred.
 * | `RATE_LIMITED` | 429 | rate limiter tripped; `details` carries `retryAfter` seconds (ADR-0020) |
 * | `INTERNAL_ERROR` | 500 | anything unexpected; the message is always generic |
 * | `SERVICE_UNAVAILABLE` | 503 | a dependency is down — readiness failure (ADR-0016) |
 */
const GENERIC_ERROR_CODES = [
  "VALIDATION_ERROR",
  "MALFORMED_JSON",
  "PAYLOAD_TOO_LARGE",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "ROUTE_NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
  "SERVICE_UNAVAILABLE",
] as const;

/**
 * Authentication and session codes (ADR-0018). They exist as distinct codes
 * because the client's reaction differs: refresh, re-login, or give up.
 *
 * | Code | Status | Raised when | Client should |
 * |---|---|---|---|
 * | `AUTH_INVALID_CREDENTIALS` | 401 | unknown email **or** wrong password — deliberately indistinguishable | show one generic message |
 * | `AUTH_TOKEN_INVALID` | 401 | access token missing, malformed, wrongly signed, or `aud` of the other population | re-login |
 * | `AUTH_TOKEN_EXPIRED` | 401 | access token past `exp`, everything else valid | refresh, then retry |
 * | `AUTH_SESSION_REVOKED` | 401 | the token verifies but its session row is revoked (logout elsewhere, admin action) | re-login |
 * | `AUTH_INVALID_REFRESH_TOKEN` | 401 | refresh token unknown or past `refresh_token_expires_at` | re-login |
 * | `AUTH_REFRESH_REUSED` | 401 | a rotated refresh token was replayed outside the grace window; the session is revoked | re-login and warn the user |
 * | `AUTH_ACCOUNT_DISABLED` | 403 | credentials are correct but `status != active` | show a support message |
 */
const AUTH_ERROR_CODES = [
  "AUTH_INVALID_CREDENTIALS",
  "AUTH_TOKEN_INVALID",
  "AUTH_TOKEN_EXPIRED",
  "AUTH_SESSION_REVOKED",
  "AUTH_INVALID_REFRESH_TOKEN",
  "AUTH_REFRESH_REUSED",
  "AUTH_ACCOUNT_DISABLED",
] as const;

/**
 * Domain codes owned by a feature module's `<module>.errors.ts` (ADR-0013).
 *
 * | Code | Status | Raised when |
 * |---|---|---|
 * | `USER_EMAIL_TAKEN` | 409 | `POST /api/v1/admin/users` with an email already in the `users` table |
 * | `USER_CURRENT_PASSWORD_INVALID` | 403 | `POST /api/v1/user/profile/change-password` where `currentPassword` does not verify |
 * | `STAFF_EMAIL_TAKEN` | 409 | `POST /api/v1/admin/staff` with an email already in the `staff` table |
 * | `STAFF_LAST_SUPER_ADMIN` | 409 | disabling or demoting the only remaining `super_admin` (ADR-0017 invariant) |
 *
 * `USER_CURRENT_PASSWORD_INVALID` is `403` and not `401` on purpose. The caller
 * *is* authenticated — their session is fine and stays fine — so a `401` would
 * be untrue about the request and would send every client interceptor that
 * treats `401` as "the session died" to the login screen over a typo.
 *
 * Emails are unique **within** a population, so the two "taken" codes are
 * separate: the same person may hold both a staff and a user account.
 *
 * Both "taken" codes belong to **authenticated staff** endpoints, which is why
 * they may name the
 * conflict. Public self-registration must not: ADR-0020 §Enumeration defaults
 * registration to a generic answer, so `POST /api/v1/public/auth/register`
 * answers an existing email with plain `CONFLICT` and a message that does not
 * confirm the address — telling an anonymous caller `USER_EMAIL_TAKEN` would
 * turn the endpoint into an account-existence oracle.
 */
const DOMAIN_ERROR_CODES = [
  "USER_EMAIL_TAKEN",
  "USER_CURRENT_PASSWORD_INVALID",
  "STAFF_EMAIL_TAKEN",
  "STAFF_LAST_SUPER_ADMIN",
] as const;

/**
 * Every error code the API can emit, in one array so clients can assert
 * exhaustive handling and a future message catalogue can be checked for gaps.
 *
 * Adding a code is additive and does not bump the API version (ADR-0015);
 * clients must therefore treat an unrecognised code as a generic failure of
 * whatever HTTP status carried it.
 */
export const ERROR_CODES = [
  ...GENERIC_ERROR_CODES,
  ...AUTH_ERROR_CODES,
  ...DOMAIN_ERROR_CODES,
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * One structured hint attached to an error.
 *
 * For `VALIDATION_ERROR` there is one entry per rejected field: `path` is the
 * dotted path into the offending object (`"filter.status"`, `"roles.0"`),
 * `message` is the zod message and `code` the zod issue code (ADR-0013).
 *
 * For other errors `path` is omitted and `code` names the hint rather than a
 * field — e.g. `{ code: 'retryAfter', message: '30' }` on `RATE_LIMITED`, or
 * `{ code: 'database', message: 'connection refused' }` on a readiness failure.
 * Detail messages are sanitised: never SQL, hostnames or credentials.
 */
export interface ErrorDetail {
  readonly path?: string;
  readonly message: string;
  readonly code?: string;
}

/** The `error` object of an error envelope (ADR-0012). */
export interface ApiError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: readonly ErrorDetail[];
  /**
   * Present only when the API runs with `NODE_ENV=development` and the error
   * was unexpected (ADR-0013). Never sent in test or production, so clients
   * must not depend on it.
   */
  readonly debug?: {
    readonly name: string;
    readonly message: string;
    readonly stack?: string;
  };
}
