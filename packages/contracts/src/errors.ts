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
 *
 * `ROUTE_NOT_FOUND` reaches a caller only where nothing intercepted first. Under
 * `/api/v1/{user,admin}` the segment's `authenticate()` runs for every request
 * entering the router, matched or not, so an unknown path there answers `401` to
 * anyone who is not an authenticated principal of that population — the API does
 * not disclose which admin paths exist (ADR-0019, amended step 9). An
 * authenticated caller of the right population, and any caller of
 * `/api/v1/public`, gets the `404`.
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
 * | `AUTH_EMAIL_UNVERIFIED` | 403 | credentials are correct but the address has never been proven (ADR-0071 §3) | offer to send the verification link again |
 * | `AUTH_CURRENT_PASSWORD_INVALID` | 403 | the caller re-presented their own password on a credential-setting endpoint and it did not verify | ask for the password again |
 * | `CSRF_TOKEN_INVALID` | 403 | a cookie-driven `refresh`, `logout` or `logout-all` arrived without an `X-CSRF-Token` matching that population's `machxi.csrf.{admin,user}` cookie (ADR-0029; ADR-0056 for the per-population name) | re-read the cookie and retry; if it persists, re-login |
 * | `AUTH_IMPERSONATION_REFUSED` | 403 | the session is impersonated (ADR-0057) and the operation is one of the takeover-enabling ones it is not allowed | tell the operator the account's owner must do it |
 * | `AUTH_FEDERATED_SIGNUP_CLOSED` | 403 | a Google sign-in found no account and `FEATURE_USER_REGISTRATION` is off, so none may be created (ADR-0072 §1) | say that new accounts are not being made here |
 * | `AUTH_FEDERATED_LINK_REQUIRED` | 403 | a Google sign-in's address is one Google does not host, so its "verified" proves nothing about the mailbox today — answered the same whether or not an account holds it (ADR-0072 §1) | ask the person to sign in or register with a password and link Google from their account |
 *
 * The two `AUTH_FEDERATED_*` codes never travel in an envelope. The Google
 * callback is a top-level navigation, so every refusal it makes is a `302` to
 * the customer app with the code in the URL fragment (`#error=<code>`,
 * ADR-0072 §2), and the app renders the catalogue's sentence for it. They are
 * codes rather than prose because that fragment is all the app is told, and
 * they are `403` in spirit for the reason their neighbours are: the provider
 * vouched for the person, and it is the operation that is refused.
 *
 * `AUTH_CURRENT_PASSWORD_INVALID` is `403` and not `401` on purpose. The caller
 * *is* authenticated — their session is fine and stays fine — so a `401` would
 * be untrue about the request and would send every client interceptor that
 * treats `401` as "the session died" to the login screen over a typo.
 *
 * `AUTH_EMAIL_UNVERIFIED` is deliberately **distinguishable** from
 * `AUTH_ACCOUNT_DISABLED`, which is the one place in the authentication flow
 * where ADR-0020 §Enumeration permits a distinction: it is raised only after the
 * password has verified, so the caller has already proven they hold the account
 * and there is nothing left to protect. Telling them "this account is disabled,
 * contact support" when the truth is "open the link we mailed you" is a support
 * ticket the API could have answered itself. It is `403` for the reason its
 * neighbours are — the request is refused, not the credential.
 *
 * `CSRF_TOKEN_INVALID` is listed here because the three endpoints it guards are
 * the auth ones, and it is deliberately **not** `AUTH_`-prefixed: the caller's
 * credentials are fine and their session is untouched. What failed is the
 * request's integrity — the double-submit token that proves the browser meant
 * to send it (ADR-0029) — which is a different question from who is asking.
 *
 * It is an auth code rather than a users-module one because the condition it
 * reports is a property of the credential check and not of any aggregate: all
 * four of `/api/v1/{admin,user}/profile/change-password` and
 * `POST /api/v1/admin/{staff,users}/:id/password` ask the same question about
 * the same caller (ADR-0027 §Contracts). It was `USER_CURRENT_PASSWORD_INVALID`
 * until D2.3 renamed it, while the only consumer was this repository's Postman
 * collection.
 *
 * `AUTH_IMPERSONATION_REFUSED` is **one code for a class**, not one per
 * operation (ADR-0057 §5). The three excluded routes —
 * `POST /api/v1/user/profile/change-password`, `DELETE /api/v1/user/profile`
 * and `POST /api/v1/user/auth/logout-all` — are exactly the operations that
 * would let an impersonator take the account over, and a code per operation
 * would be enum growth with no reader: the client already knows which dialog
 * it opened. It is `403` for the reason `AUTH_CURRENT_PASSWORD_INVALID` is —
 * the session is fine and stays fine, so a `401` would send every interceptor
 * that reads `401` as "the session died" to a sign-in screen over a refusal
 * that has nothing to do with credentials.
 */
const AUTH_ERROR_CODES = [
  "AUTH_INVALID_CREDENTIALS",
  "AUTH_TOKEN_INVALID",
  "AUTH_TOKEN_EXPIRED",
  "AUTH_SESSION_REVOKED",
  "AUTH_INVALID_REFRESH_TOKEN",
  "AUTH_REFRESH_REUSED",
  "AUTH_ACCOUNT_DISABLED",
  "AUTH_EMAIL_UNVERIFIED",
  "AUTH_CURRENT_PASSWORD_INVALID",
  "AUTH_IMPERSONATION_REFUSED",
  "AUTH_FEDERATED_SIGNUP_CLOSED",
  "AUTH_FEDERATED_LINK_REQUIRED",
  "CSRF_TOKEN_INVALID",
] as const;

/**
 * Domain codes owned by a feature module's `<module>.errors.ts` (ADR-0013).
 *
 * | Code | Status | Raised when |
 * |---|---|---|
 * | `USER_EMAIL_TAKEN` | 409 | `POST /api/v1/admin/users` with an email already in the `users` table |
 * | `USER_DELETED` | 409 | a write aimed at a soft-deleted user account (ADR-0028) |
 * | `STAFF_EMAIL_TAKEN` | 409 | `POST /api/v1/admin/staff` with an email already in the `staff` table |
 * | `STAFF_LAST_SUPER_ADMIN` | 409 | disabling or demoting the only remaining `super_admin` (ADR-0017 invariant) |
 * | `STAFF_NOT_INVITED` | 409 | re-sending an onboarding link to an operator who is not `invited` (ADR-0071 §8) |
 * | `STAFF_INVITATION_PENDING` | 409 | setting a password on, or activating, an operator who has not accepted their invitation (ADR-0071 §8) |
 * | `ORGANIZATION_LAST_OWNER` | 409 | removing, demoting or leaving as the only remaining `owner` (ADR-0067 §2 invariant) |
 * | `ORGANIZATION_PERSONAL_UNDELETABLE` | 409 | `DELETE` aimed at a `personal` organization, which goes with its account and never on its own (ADR-0067 §2) |
 * | `ORGANIZATION_PERSONAL_CLOSED` | 409 | a second member aimed at a `personal` organization, which has exactly one (ADR-0067 §2) |
 * | `ORGANIZATION_INVITATION_PENDING` | 409 | inviting an address that already has a pending invitation to the same organization |
 * | `ORGANIZATION_INVITATION_ADDRESS_MISMATCH` | 403 | accepting an invitation from its link while signed in as an account whose address is not the invited one (ADR-0071 §5) |
 *
 * Both organization codes are `409` rather than `403` for the reason
 * `STAFF_LAST_SUPER_ADMIN` is: the caller may hold exactly the role the route
 * requires, and what the request conflicts with is the organization's state.
 * There is deliberately **no** code for "you are not a member" — that is a
 * plain `404 NOT_FOUND`, because a distinct code would disclose in the
 * envelope the existence the status was careful not to (ADR-0067 §4).
 *
 * `USER_DELETED` is `409` and not `404`: the account exists and the caller may
 * still *read* it — `GET /:id` answers `200` for a deleted account on purpose,
 * because an admin who can list deleted accounts must be able to open one. What
 * the request conflicts with is the account's state, which is the same
 * distinction `STAFF_LAST_SUPER_ADMIN` draws. `410 Gone` would claim the
 * resource is permanently unavailable at this URL, and it is not.
 *
 * Emails are unique **within** a population, so the two "taken" codes are
 * separate: the same person may hold both a staff and a user account. Since
 * ADR-0028 the uniqueness is partial — `USER_EMAIL_TAKEN` means a *live*
 * account holds the address, not that it has ever been used.
 *
 * Both "taken" codes belong to **authenticated staff** endpoints, which is why
 * they may name the
 * conflict. Public self-registration must not: ADR-0020 §Enumeration defaults
 * registration to a generic answer, so `POST /api/v1/public/auth/register`
 * answers an existing email with plain `CONFLICT` and a message that does not
 * confirm the address — telling an anonymous caller `USER_EMAIL_TAKEN` would
 * turn the endpoint into an account-existence oracle.
 *
 * `STAFF_NOT_INVITED` is `409` for `USER_DELETED`'s reason exactly: the row
 * exists and the caller may read it, and what the request conflicts with is
 * the account's state — an operator who has already onboarded, or one an
 * admin has since disabled, has no pending link to replace. It names the
 * conflict because, like the two "taken" codes, it is answered only to an
 * authenticated `admin` who can already read the row's status.
 *
 * `STAFF_INVITATION_PENDING` is its mirror and the same `409` for the same
 * reason: an operator who has not yet followed their invitation has no
 * password for `POST /:id/password` to replace, and is made `active` by the
 * link rather than by an edit (ADR-0071 §8). Both refusals exist because
 * `invited` became a state an admin creates on purpose at `D18.11`, where
 * before it was a status nothing wrote.
 */
const DOMAIN_ERROR_CODES = [
  "USER_EMAIL_TAKEN",
  "USER_DELETED",
  "STAFF_EMAIL_TAKEN",
  "STAFF_LAST_SUPER_ADMIN",
  "STAFF_NOT_INVITED",
  "STAFF_INVITATION_PENDING",
  "ORGANIZATION_LAST_OWNER",
  "ORGANIZATION_PERSONAL_UNDELETABLE",
  "ORGANIZATION_PERSONAL_CLOSED",
  "ORGANIZATION_INVITATION_PENDING",
  "ORGANIZATION_INVITATION_ADDRESS_MISMATCH",
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
 * Whether a `code` off the wire is one *this build* knows.
 *
 * The guard exists because the sentence above is a rule for clients and a rule
 * needs a way to be obeyed: a bundle deployed before a code was added meets it
 * as a plain string, and the only honest thing it can do is ask. A caller that
 * gets `false` degrades by HTTP status (`@repo/api-client`'s
 * `genericCodeForStatus`) rather than treating the response as unparseable —
 * which is what the envelope schema's deliberately wide `code` makes possible.
 */
export const isErrorCode = (code: string): code is ErrorCode =>
  (ERROR_CODES as readonly string[]).includes(code);

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
