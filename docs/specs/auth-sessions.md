# Authentication and sessions

Two populations sign in on two segments — `/api/v1/admin/auth` for staff, `/api/v1/user/auth` for users — with the same flows: a password login that issues a short-lived access token and an opaque refresh token, rotation with reuse detection, revocation that takes effect immediately, and one public self-registration endpoint. Where the refresh token travels is [`csrf-and-cookies.md`](csrf-and-cookies.md); the impersonated variant of a session is [`impersonation.md`](impersonation.md); what registration's link does, and every other flow that arrives by mail, is [`mail-flows.md`](mail-flows.md).

## Requirement: Login answers a session or one indistinguishable refusal

`POST /auth/login` with `{ email, password }` answers `200` with `accessToken`, `accessTokenExpiresAt`, `refreshToken`, `refreshTokenExpiresAt` and the `principal`. An unknown address and a wrong password answer the same `401 AUTH_INVALID_CREDENTIALS`, in the same time — the verifier runs against a dummy hash when no account matched, and so does an account with **no password**, one created by a sign-in with Google ([`federated-identity.md`](federated-identity.md)): the answer must not say which way in exists. Only after the password verifies is the account's status considered.
Records: [ADR-0018](../adr/0018-authentication-sessions-and-tokens.md), [ADR-0020](../adr/0020-security-baseline.md), [ADR-0017](../adr/0017-identity-model-populations-and-roles.md), [ADR-0072](../adr/0072-federated-identity-google-sign-in.md)
Proved by: `apps/api/test/auth.int.test.ts`, `apps/api/test/auth-segments.int.test.ts`, `apps/api/test/federated-identity.int.test.ts`

### Scenario: Correct credentials

- **WHEN** an active account presents its email and password on its own segment
- **THEN** the answer is `200` with both tokens, the principal carrying the account's roles, and `lastLoginAt` moves

### Scenario: Unknown email, or wrong password

- **WHEN** the address is unknown, or known with a wrong password
- **THEN** the answer is `401 AUTH_INVALID_CREDENTIALS` in both cases, with nothing that distinguishes them

### Scenario: An account with no password

- **WHEN** any password is presented for an account that signs in only through Google
- **THEN** the answer is `401 AUTH_INVALID_CREDENTIALS`, indistinguishable from a wrong password

### Scenario: Correct password, inactive account

- **WHEN** the password verifies but the account is `disabled`, or `invited` for staff
- **THEN** the answer is `403 AUTH_ACCOUNT_DISABLED`

### Scenario: Correct password, address never proven

- **WHEN** the password verifies and the user account is `pending_verification`
- **THEN** the answer is `403 AUTH_EMAIL_UNVERIFIED` — distinguishable from a disabled account, because the caller has already proven they hold it ([`mail-flows.md`](mail-flows.md))

### Scenario: The other population's segment

- **WHEN** a staff member's credentials are presented at `/api/v1/user/auth/login`
- **THEN** the answer is `401 AUTH_INVALID_CREDENTIALS` — the populations are separate tables, not a shared account with a type

## Requirement: Refresh rotates the token and detects its reuse

`POST /auth/refresh` with a live refresh token answers `200` with a new pair and retires the presented token. Presenting the retired token again within `REFRESH_ROTATION_GRACE_SEC` of the rotation is a tolerated retry; after that the session is revoked and the answer is `401 AUTH_REFRESH_REUSED`.
Records: [ADR-0018](../adr/0018-authentication-sessions-and-tokens.md)
Proved by: `apps/api/test/auth.int.test.ts`

### Scenario: A live token

- **WHEN** a client presents the refresh token it was last issued
- **THEN** the answer is `200` with a new access token and a new refresh token, and the session's expiry slides forward

### Scenario: Replay inside the grace window

- **WHEN** the previous token is presented again within `REFRESH_ROTATION_GRACE_SEC` of the rotation
- **THEN** the answer is `200` — two concurrent refreshes both succeed

### Scenario: Replay outside the grace window

- **WHEN** the previous token is presented after the grace window
- **THEN** the answer is `401 AUTH_REFRESH_REUSED`, the session is revoked with reason `refresh_reuse`, and the current token no longer works either

### Scenario: Unknown, expired or foreign

- **WHEN** the token is unknown, past its expiry, or belongs to a session of the other population
- **THEN** the answer is `401 AUTH_INVALID_REFRESH_TOKEN`, identical in all three cases

### Scenario: The account was disabled meanwhile

- **WHEN** a live token is presented for an account no longer active
- **THEN** the answer is `403 AUTH_ACCOUNT_DISABLED` and every session of the account is revoked

## Requirement: An access token names a live session of the right population

Every guarded route reads `Authorization: Bearer <access token>`. The token's signature, expiry, issuer and population audience are verified, and the session it names is looked up on every request, so a logout or an administrative revocation takes effect immediately rather than at the token's expiry.
Records: [ADR-0018](../adr/0018-authentication-sessions-and-tokens.md), [ADR-0019](../adr/0019-authorization-guards.md), [ADR-0064](../adr/0064-brand-seams.md)
Proved by: `apps/api/test/auth-segments.int.test.ts`, `apps/api/test/auth.int.test.ts`

### Scenario: No credentials

- **WHEN** a guarded route is requested with no `Authorization` header
- **THEN** the answer is `401 UNAUTHENTICATED`

### Scenario: The wrong kind of credential

- **WHEN** the header is present but not a usable bearer token, the signature is wrong, or the token was minted for the other population — or for another `APP_ID`
- **THEN** the answer is `401 AUTH_TOKEN_INVALID`

### Scenario: Expired

- **WHEN** the token is past `exp` and otherwise valid
- **THEN** the answer is `401 AUTH_TOKEN_EXPIRED`, which a client answers by refreshing and retrying

### Scenario: Revoked underneath

- **WHEN** the token verifies but its session has been revoked or has expired
- **THEN** the answer is `401 AUTH_SESSION_REVOKED`

## Requirement: Logout ends this session; logout-all ends every one

`POST /auth/logout` revokes the session the access token names and answers `204`; `POST /auth/logout-all` revokes every live session of the principal. Both clear this population's cookies, whether or not the caller had any.
Records: [ADR-0018](../adr/0018-authentication-sessions-and-tokens.md)
Proved by: `apps/api/test/auth.int.test.ts`, `apps/api/test/auth-cookie.int.test.ts`

### Scenario: After logout

- **WHEN** the refresh token of a logged-out session is presented
- **THEN** the answer is `401 AUTH_SESSION_REVOKED`

### Scenario: After logout-all

- **WHEN** an account signed in on two devices calls `logout-all` from one
- **THEN** both sessions are revoked and both devices' next refresh answers `401 AUTH_SESSION_REVOKED`

## Requirement: `me` re-reads the account

`GET /auth/me` answers the principal from the database rather than from the token's claims, so a client can resynchronise after a role or profile change. On the user segment it also answers **`hasPassword`** and **`identities`** — which ways into the account exist — which the token-issuing bodies do not carry. An account deleted or disabled inside its token's lifetime is signed out here rather than at the next expiry.
Records: [ADR-0018](../adr/0018-authentication-sessions-and-tokens.md), [ADR-0057](../adr/0057-impersonation-sessions.md), [ADR-0072](../adr/0072-federated-identity-google-sign-in.md)
Proved by: `apps/api/test/auth.int.test.ts`, `apps/api/test/federated-identity.int.test.ts`

### Scenario: A live account

- **WHEN** a principal calls `me`
- **THEN** the answer is `200` with the principal resource as the database holds it, and it carries no `impersonatedBy` — that field travels on `refresh`

### Scenario: A customer created through Google

- **WHEN** an account made by a sign-in with Google calls `GET /api/v1/user/auth/me`
- **THEN** the principal carries `hasPassword: false` and its one identity `{ provider: "google", email, linkedAt }`

### Scenario: The account is gone

- **WHEN** the account behind a valid token has been deleted or disabled
- **THEN** the answer is `401 AUTH_SESSION_REVOKED` and every session of the account is revoked

## Requirement: Self-registration is public, optional, and never an oracle

`POST /api/v1/public/auth/register` exists only when `FEATURE_USER_REGISTRATION` is on; with it off the path does not exist. It creates a user account with the `customer` role, `pending_verification`, and its personal organization in the same transaction ([`organizations.md`](organizations.md)), mails a confirmation link, and answers `202 { accepted: true }` with **no session on either transport** — the link is what signs a device in ([`mail-flows.md`](mail-flows.md)). A taken address answers the same generic `409 CONFLICT` a client would get for any constraint, never a code that confirms the address. Staff have no such endpoint.
Records: [ADR-0071](../adr/0071-mail-flows.md), [ADR-0018](../adr/0018-authentication-sessions-and-tokens.md), [ADR-0020](../adr/0020-security-baseline.md), [ADR-0004](../adr/0004-configuration-and-environment.md), [ADR-0017](../adr/0017-identity-model-populations-and-roles.md)
Proved by: `apps/api/test/auth-register.int.test.ts`, `apps/api/test/mail-flows.int.test.ts`, `apps/api/src/core/config/__tests__/config.test.ts`

### Scenario: A fresh address

- **WHEN** an anonymous client registers an unused address with a policy-conforming password
- **THEN** the answer is `202 { accepted: true }`, the account is `pending_verification` with no `email_verified_at`, and no `Set-Cookie` and no token leave the endpoint

### Scenario: A taken address

- **WHEN** the address belongs to a live account
- **THEN** the answer is `409 CONFLICT` with a message that does not name the address, and nothing is mailed

### Scenario: The feature is off

- **WHEN** `FEATURE_USER_REGISTRATION=false`
- **THEN** the path answers `404 ROUTE_NOT_FOUND`, not `403` — while `verify-email` and `resend-verification` stay mounted

## Requirement: Credential endpoints are rate limited per address and per account

Login and registration share one budget of `RATE_LIMIT_LOGIN_MAX` per fifteen minutes keyed on the client address **and** the presented email; a refresh answered `401` spends `RATE_LIMIT_REFRESH_MAX` per fifteen minutes per address, and any other answer — a successful rotation, a `403` CSRF refusal, a `400` — spends nothing; every `/api` request counts against a global `RATE_LIMIT_GLOBAL_MAX` per address. A tripped limit answers `429 RATE_LIMITED` with a `Retry-After` header and a `retryAfter` detail. A request the schema rejects still counts.
Records: [ADR-0020](../adr/0020-security-baseline.md), [ADR-0066](../adr/0066-infrastructure-seams.md)
Proved by: `apps/api/test/rate-limit.int.test.ts`

### Scenario: Guessing one account's password

- **WHEN** one address sends more login attempts for one email than the limit allows inside fifteen minutes
- **THEN** the next attempt answers `429 RATE_LIMITED` with `Retry-After`, and a different email from the same address is unaffected until the global limit

### Scenario: Legitimate refreshes are free

- **WHEN** a client refreshes successfully many times inside fifteen minutes
- **THEN** none of them spends the refresh budget

### Scenario: The shared store fails closed

- **WHEN** a configured Redis store is unreachable
- **THEN** requests are refused rather than admitted without a count
