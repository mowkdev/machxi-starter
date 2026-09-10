# Mail flows

Every flow that needs a mailbox runs on one mechanism: a single-use token, hashed at rest, delivered in a link's **fragment**, and consumed once inside the transaction that acts on it ([ADR-0071](../adr/0071-mail-flows.md) §1). A fragment never reaches a server, so no access log, proxy or `Referer` header ever holds one of these credentials; each purpose has its own lifetime, and a mint supersedes the live token for the same account and purpose, so pressing "resend" leaves one working link rather than a growing set.

This file is the wire behaviour of those flows. The session a link ends in is [`auth-sessions.md`](auth-sessions.md); where the refresh token travels is [`csrf-and-cookies.md`](csrf-and-cookies.md).

## Requirement: An account is usable once its address is proven

Self-registration creates a `pending_verification` account and mails a confirmation link, answering `202 { accepted: true }` with no session. `POST /api/v1/public/auth/verify-email { token }` consumes the link, makes the account `active` with its address stamped proven, writes an `account.verified` audit row, and answers `200` with login's body on whichever transport the caller asked for. Login on such an account with the **right** password answers `403 AUTH_EMAIL_UNVERIFIED`, and with the wrong one the usual `401 AUTH_INVALID_CREDENTIALS`. `POST /api/v1/public/auth/resend-verification { email }` answers `202 { accepted: true }` for every address, whether or not one exists. Both verification endpoints are mounted even where `FEATURE_USER_REGISTRATION` is off.
Records: [ADR-0071](../adr/0071-mail-flows.md), [ADR-0018](../adr/0018-authentication-sessions-and-tokens.md), [ADR-0020](../adr/0020-security-baseline.md), [ADR-0058](../adr/0058-append-only-audit-log.md)
Proved by: `apps/api/test/mail-flows.int.test.ts`, `apps/api/test/auth-register.int.test.ts`, `apps/api/src/modules/auth/__tests__/auth.service.test.ts`

### Scenario: Registering an unused address

- **WHEN** an anonymous client registers an address no live account holds
- **THEN** the answer is `202 { accepted: true }` with no `Set-Cookie` and no token in the body, the account is `pending_verification`, exactly one message is sent to that address, and exactly one unconsumed `verify_email` token row exists

### Scenario: The link's shape

- **WHEN** any of these messages is rendered
- **THEN** the token appears after `#` in the link and nowhere in its path or query, and the database holds only the token's SHA-256

### Scenario: Following the link

- **WHEN** the token from the message is posted to `verify-email`
- **THEN** the answer is `200` with login's body — the refresh token in the body, or in the refresh cookie for a caller sending `X-Auth-Transport: cookie` — the account is `active` with `email_verified_at` set, and an `account.verified` audit row names the account as actor with no acting-as

### Scenario: Following it twice

- **WHEN** the same token is posted again
- **THEN** the answer is `401 UNAUTHENTICATED` and no session is placed

### Scenario: A token nobody minted

- **WHEN** an unknown, expired, foreign-purpose or foreign-population token is posted
- **THEN** the answer is the same `401 UNAUTHENTICATED` — one answer for every case, because the caller is an anonymous holder of a URL fragment

### Scenario: A live link whose account can no longer be activated

- **WHEN** the account was deleted or disabled between the mint and the click
- **THEN** the answer is `401 UNAUTHENTICATED` and the token's `consumed_at` is still null — a refused consumption spends nothing

### Scenario: Signing in before the address is proven

- **WHEN** the right password is presented for a `pending_verification` account
- **THEN** the answer is `403 AUTH_EMAIL_UNVERIFIED`, distinct from the `403 AUTH_ACCOUNT_DISABLED` a disabled account gets

### Scenario: Signing in with the wrong password before it is proven

- **WHEN** a wrong password is presented for the same account
- **THEN** the answer is `401 AUTH_INVALID_CREDENTIALS` — the status is only consulted once the password verifies, so an unverified account is indistinguishable from an unknown address

### Scenario: Asking for the link again

- **WHEN** `resend-verification` is called for an address that is waiting
- **THEN** the answer is `202 { accepted: true }`, a message is sent, and the previous link stops working while the new one works

### Scenario: Asking for the link for anybody else

- **WHEN** `resend-verification` is called for an address nobody holds, or for an account that is already active
- **THEN** the answer is the identical `202 { accepted: true }` and nothing is sent

### Scenario: Self-registration switched off

- **WHEN** `FEATURE_USER_REGISTRATION=false`
- **THEN** `register` answers `404 ROUTE_NOT_FOUND` while `verify-email` and `resend-verification` still answer — a link already in somebody's mailbox does not stop working because sign-ups were closed

## Requirement: An address a staff member types is proven by that assertion

`POST /api/v1/admin/users` stamps `email_verified_at` on the account it creates, because the operator who typed the address is the authority a confirmation link would be asking, and no link is sent; `PATCH /api/v1/admin/users/:id` stamps it the same way when it moves an account to `active`, without disturbing a stamp the account already had. An admin who deliberately asks for `status: "pending_verification"` gets an account with no stamp, which is the one row the verification flow above has something to do to. Those two paths and the link are **every** way a user becomes `active`, which is what makes **every `active` user an account whose address is proven**.
Records: [ADR-0071](../adr/0071-mail-flows.md), [ADR-0017](../adr/0017-identity-model-populations-and-roles.md)
Proved by: `apps/api/src/modules/users/__tests__/users.service.test.ts`, `apps/api/test/users-admin.int.test.ts`

### Scenario: Staff create an account

- **WHEN** a staff member creates a user without naming a status
- **THEN** the account is `active` and its `email_verified_at` is set, and no message is sent

### Scenario: Staff create a pending account

- **WHEN** a staff member creates a user with `status: "pending_verification"`
- **THEN** `email_verified_at` stays null

### Scenario: Staff clear a stuck account from the grid

- **WHEN** a staff member patches a `pending_verification` account to `active`
- **THEN** `email_verified_at` is stamped in the same statement, so the account cannot be `active` with an unproven address

### Scenario: Staff re-enable an account that was already proven

- **WHEN** a staff member patches a `disabled` account back to `active`
- **THEN** the `email_verified_at` it already carried is left as it was — it records when the address was proven, not when the account was last enabled
