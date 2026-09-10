# Impersonation

Staff open the customer app as a chosen customer. An admin mints a one-time handoff; the customer app exchanges it for a `user` session that records the acting staff member, ends at a fixed time, is refused the takeover-enabling operations, and leaves a trail on every request. Ordinary sessions are untouched by all of it.

## Requirement: An admin mints a single-use handoff for an active customer

`POST /admin/users/:id/impersonate` is `admin`-only, budgeted per staff principal rather than per address, and answers a handoff token with its expiry — never a cookie. The target must be live and active: an unknown id answers `404 NOT_FOUND`, a deleted one `409 USER_DELETED`, an inactive one `409 CONFLICT`. The mint writes `impersonation.minted` to the audit log in its own transaction.
Records: [ADR-0057](../adr/0057-impersonation-sessions.md), [ADR-0058](../adr/0058-append-only-audit-log.md)
Proved by: `apps/api/test/impersonation.int.test.ts`, `apps/api/test/audit-events.int.test.ts`

### Scenario: A manager mints

- **WHEN** a `manager` calls the mint
- **THEN** the answer is `403 FORBIDDEN` and no budget is spent

### Scenario: The budget

- **WHEN** one admin mints more than `RATE_LIMIT_IMPERSONATION_MAX` times inside fifteen minutes
- **THEN** the next mint answers `429 RATE_LIMITED`

### Scenario: The response sets nothing

- **WHEN** the mint succeeds
- **THEN** the response carries no `Set-Cookie` and the staff session is unchanged

## Requirement: The exchange opens a session as login does, once

`POST /user/auth/impersonate` with `{ token }` is unauthenticated — the token is the credential — and answers login's body with `principal.impersonatedBy: { id, email }` naming the operator, placing the user population's cookies on cookie transport exactly as login does. It exists on the user segment only. Every refusal — replayed, expired, unknown, target no longer active, operator gone or inactive — is one indistinguishable `401 UNAUTHENTICATED`, and a refused exchange does not spend the token. A refresh cookie arriving with the exchange is never a credential for it, and is read for one purpose: an **impersonated** session it resolves to is the one this exchange replaces, so it is revoked with reason `impersonation_ended` and given an `impersonation.ended` row saying it was replaced and naming the staff member and handoff that replaced it, in the exchange's own transaction and before the new session is minted. A **real** customer session, and a cookie that resolves to nothing, change nothing.
Records: [ADR-0057](../adr/0057-impersonation-sessions.md), [ADR-0070](../adr/0070-impersonation-in-a-new-tab.md), [ADR-0020](../adr/0020-security-baseline.md)
Proved by: `apps/api/test/impersonation.int.test.ts`

### Scenario: Redeemed once

- **WHEN** a valid handoff is exchanged
- **THEN** the answer is `200` with an impersonated `user` principal, and a second exchange of the same token answers `401 UNAUTHENTICATED` with no new session

### Scenario: The target was disabled between mint and exchange

- **WHEN** the customer is disabled after the mint and before the exchange
- **THEN** the exchange answers `401 UNAUTHENTICATED`

### Scenario: A second impersonation in the same browser

- **WHEN** an exchange carries the refresh cookie of a live impersonated session
- **THEN** that session's refresh token answers `401 AUTH_SESSION_REVOKED`, and an `impersonation.ended` row names it as replaced and names the exchange that replaced it

### Scenario: A real customer session in the same browser

- **WHEN** an exchange carries the refresh cookie of a real customer session, or one that resolves to nothing
- **THEN** the exchange mints as it always did and that session goes on refreshing

### Scenario: The admin segment

- **WHEN** the same body is posted to `/admin/auth/impersonate`
- **THEN** the answer is as for an unknown path — the route is not registered there

## Requirement: An impersonated session ends at a fixed time

The session's expiry is anchored at the exchange plus `IMPERSONATION_SESSION_TTL`; a refresh rotates the token without moving that end, and every access token issued for it expires no later than it. The staff member's own session is never touched.
Records: [ADR-0057](../adr/0057-impersonation-sessions.md)
Proved by: `apps/api/test/impersonation.int.test.ts`

### Scenario: Refresh does not extend

- **WHEN** an impersonated session is refreshed
- **THEN** `refreshTokenExpiresAt` in the answer equals the value the exchange returned

### Scenario: The refresh cookie's path

- **WHEN** the exchange runs on cookie transport
- **THEN** the refresh cookie is scoped to `/api/v1/user/auth` and no admin cookie is written

## Requirement: The takeover-enabling operations are refused

Under an impersonated session, `POST /user/profile/change-password`, `POST /user/profile/change-email`, `DELETE /user/profile`, `POST /user/auth/logout-all` and `POST /user/invitations/accept-by-token` answer `403 AUTH_IMPERSONATION_REFUSED` before any body is validated or any hash computed, and each refusal is written to the audit log as `impersonation.refused`. `PATCH /user/profile` is deliberately not among them: it is what support opens the app to do, and its body cannot carry an address. Every other operation succeeds and is recorded in the trail with both identities.
Records: [ADR-0057](../adr/0057-impersonation-sessions.md), [ADR-0058](../adr/0058-append-only-audit-log.md), [ADR-0067](../adr/0067-organizations.md), [ADR-0071](../adr/0071-mail-flows.md)
Proved by: `apps/api/test/impersonation-exclusions.int.test.ts`

### Scenario: An excluded operation

- **WHEN** an impersonated session calls `change-password`
- **THEN** the answer is `403 AUTH_IMPERSONATION_REFUSED`, and the same call on the customer's real session succeeds

### Scenario: A change of address

- **WHEN** an impersonated session calls `change-email`
- **THEN** the answer is `403 AUTH_IMPERSONATION_REFUSED`, nothing is mailed to the address the operator typed, and the same call on the customer's real session answers `202`

### Scenario: An allowed write

- **WHEN** an impersonated session patches the customer's settings
- **THEN** the answer is `200` and an audit row records the staff member as actor and the customer as acting-as

## Requirement: The exit is logout, and revoking the operator ends what they were driving

`POST /user/auth/logout` on an impersonated session revokes it with reason `impersonation_ended` and writes `impersonation.ended`, in one transaction. Every path that revokes a staff member's sessions — disabling, deleting, forced logout, `logout-all` — also ends the impersonated sessions minted through them, each with its own `impersonation.ended` row.
Records: [ADR-0057](../adr/0057-impersonation-sessions.md), [ADR-0058](../adr/0058-append-only-audit-log.md)
Proved by: `apps/api/test/impersonation-exclusions.int.test.ts`, `apps/api/test/impersonation.int.test.ts`

### Scenario: The banner's exit

- **WHEN** the impersonated session logs out
- **THEN** its refresh token answers `401 AUTH_SESSION_REVOKED` afterwards and the staff session still refreshes

### Scenario: The operator is disabled mid-session

- **WHEN** an admin disables the staff member who minted a live impersonation
- **THEN** the impersonated session's next request answers `401 AUTH_SESSION_REVOKED`
