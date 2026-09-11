# Federated identity

A customer signs in to the customer app, or creates an account there, through Google: plain OpenID Connect with PKCE, the transaction between the start and the callback held in one signed cookie, and the callback handing the app a sixty-second single-use token in a URL fragment, exchanged for a session the way the verification link's is ([`mail-flows.md`](mail-flows.md)). Staff have no federated sign-in. Where the refresh token travels afterwards is [`csrf-and-cookies.md`](csrf-and-cookies.md); which ways into an account exist is on `me` ([`auth-sessions.md`](auth-sessions.md)) and on the profile ([`users-and-profile.md`](users-and-profile.md)).

## Requirement: A person signs in through Google

`POST /api/v1/public/auth/google/start` takes a JSON body — anything else is `400 VALIDATION_ERROR` — and answers `200 { authorizationUrl }`: Google's authorization endpoint carrying a fresh `state`, `nonce` and PKCE `S256` challenge. It sets `__Host-machxi.oidc` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, ten minutes), whose value is the signed transaction. `GET /api/v1/public/auth/google/callback` spends that transaction on every outcome and answers `302` to `${CUSTOMER_APP_URL}/auth/google` with either `#token=<handoff>` or `#error=<code>` and nothing else in the fragment. On a refusal it clears the cookie; on a sign-in it replaces it with the **handoff binding**, which names the token and lives as long as it does. It resolves the person Google vouched for in this order: **by subject**, whatever address either side now carries; **by address**, only when Google says the address is verified, Google hosts the mailbox, and a live `active` account holds it — which links the identity to that account; **by creation**, only when Google says the address is verified and hosts it, no account holds it, and `FEATURE_USER_REGISTRATION` is on — an `active` account with no password, its address stamped proven, its personal organization and the identity, in one commit. `POST /api/v1/public/auth/google/exchange { token }` answers only in the browser holding the binding for that token: it spends the handoff once and answers `200` with login's body on whichever transport the caller asked for, and clears the cookie. A spent, expired, unknown or unbound token, or one whose account is no longer `active`, answers `401 UNAUTHENTICATED`.
Records: [ADR-0072](../adr/0072-federated-identity-google-sign-in.md), [ADR-0029](../adr/0029-browser-token-transport.md), [ADR-0071](../adr/0071-mail-flows.md), [ADR-0067](../adr/0067-organizations.md), [ADR-0020](../adr/0020-security-baseline.md)
Proved by: `apps/api/test/federated-identity.int.test.ts`, `apps/api/src/modules/auth/__tests__/auth.federated.service.test.ts`, `apps/api/src/core/oidc/__tests__/transaction.test.ts`

### Scenario: The start

- **WHEN** the customer app posts `start`
- **THEN** the answer is `200 { authorizationUrl }` with `code_challenge_method=S256`, a `state` and a `nonce` on the URL and no verifier, and the transaction cookie is set `HttpOnly`, `Secure`, `SameSite=Lax`

### Scenario: A callback this browser did not start

- **WHEN** the callback's `state` does not match the cookie's, or no cookie arrives, or the person declined at Google
- **THEN** the answer is `302 …/auth/google#error=UNAUTHENTICATED`, the cookie is cleared, and no account or identity row is written

### Scenario: A stranger with a verified address

- **WHEN** Google vouches for a verified address nobody holds, with registration on
- **THEN** an `active` account exists with a null password hash, `email_verified_at` set, one personal organization it owns and one Google identity; `account.verified` and `account.identity_linked` rows name it as actor; and the answer is `302 …/auth/google#token=…`

### Scenario: The handoff is spent once

- **WHEN** the fragment token is exchanged with `X-Auth-Transport: cookie` in the browser the callback answered, and then exchanged again
- **THEN** the first answer is `200` with login's body and the refresh cookie set, and the second is `401 UNAUTHENTICATED`

### Scenario: A relayed token

- **WHEN** a fragment token is exchanged by a browser holding no binding, or another sign-in's binding
- **THEN** the answer is `401 UNAUTHENTICATED`, the cookie is cleared, and the token is not spent

### Scenario: A start that is not a JSON request

- **WHEN** `start` arrives as `text/plain`, as a cross-site form would send it
- **THEN** the answer is `400 VALIDATION_ERROR` and no transaction cookie is set

### Scenario: The account was disabled in between

- **WHEN** the account a handoff names is disabled before the token is exchanged
- **THEN** the exchange answers `401 UNAUTHENTICATED` and issues no session

### Scenario: The same Google account, after an address change

- **WHEN** a person whose account address changed signs in again with the same Google account
- **THEN** the subject resolves to the same account, its identity's `last_login_at` is stamped, and no second account is made

### Scenario: An address Google hosts, held by an active account

- **WHEN** Google vouches for a verified address it hosts, and an `active` account with a password holds it
- **THEN** the identity is linked to that account with an `account.identity_linked` row, the answer is `#token=…` for that account, and its password still signs in

### Scenario: An address Google does not host

- **WHEN** Google says a verified address it does not host belongs to the person, whether or not a live account holds it
- **THEN** the answer is `#error=AUTH_FEDERATED_LINK_REQUIRED` in both cases, and nothing is linked or created — the person signs in or registers with a password and links Google from the account

### Scenario: The holder never proved the address

- **WHEN** the address Google vouches for belongs to a `pending_verification` account
- **THEN** the answer is `#error=AUTH_EMAIL_UNVERIFIED`, nothing is linked, and the account stays `pending_verification`

### Scenario: The holder is disabled

- **WHEN** the address belongs to a `disabled` account
- **THEN** the answer is `#error=AUTH_ACCOUNT_DISABLED` and nothing is linked

### Scenario: The account already has a Google account

- **WHEN** a second Google account's address belongs to an account that already has one linked
- **THEN** the answer is `#error=CONFLICT` and the second identity is not linked

### Scenario: An unverified address

- **WHEN** Google does not say the address is verified, whether or not an account holds it
- **THEN** the answer is `#error=UNAUTHENTICATED` in both cases, and no account or identity is created

### Scenario: Registration is off

- **WHEN** `FEATURE_USER_REGISTRATION=false` and Google vouches for an address nobody holds
- **THEN** the answer is `#error=AUTH_FEDERATED_SIGNUP_CLOSED` and no row is written — while an existing identity still signs its account in

### Scenario: Google is unreachable

- **WHEN** the provider does not answer the code exchange
- **THEN** the answer is `#error=SERVICE_UNAVAILABLE`, and a start that cannot load Google's metadata answers `503 SERVICE_UNAVAILABLE`

## Requirement: The start and the callback are rationed per source

`start` and `callback` are each behind a limiter of their own on `RATE_LIMIT_LOGIN_MAX`'s number, keyed on the source address alone — there is no address in either request to key on — in counters apart from each other and from every other limiter keyed on the source, so none spends another's budget. A callback with a valid cookie costs a request to Google, which is why it has one. The exchange carries only the global limiter: the handoff's mint is where its budget belongs.
Records: [ADR-0072](../adr/0072-federated-identity-google-sign-in.md), [ADR-0020](../adr/0020-security-baseline.md)
Proved by: `apps/api/test/rate-limit.int.test.ts`

### Scenario: One source starting over and over

- **WHEN** one source posts `start` more times than `RATE_LIMIT_LOGIN_MAX` within fifteen minutes
- **THEN** the next start answers `429 RATE_LIMITED`, while the invitation lookup — another limiter keyed on the source alone — still answers on its own budget

### Scenario: One source replaying callbacks

- **WHEN** one source reaches `callback` more times than `RATE_LIMIT_LOGIN_MAX` within fifteen minutes
- **THEN** the next callback answers `429 RATE_LIMITED` — the one answer on that route that is not a redirect

## Requirement: The flow exists only where a Google client is configured

The three routes are mounted only when both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set; half a pair refuses to start the API. Without a client each path answers `404 ROUTE_NOT_FOUND`, exactly as registration does with its flag off.
Records: [ADR-0072](../adr/0072-federated-identity-google-sign-in.md), [ADR-0004](../adr/0004-configuration-and-environment.md)
Proved by: `apps/api/test/federated-identity.int.test.ts`, `apps/api/src/core/config/__tests__/config.test.ts`

### Scenario: No client

- **WHEN** the API runs without the Google client and a caller reaches `start`, `callback` or `exchange`
- **THEN** each answers `404 ROUTE_NOT_FOUND`
