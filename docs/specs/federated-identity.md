# Federated identity

A customer signs in to the customer app, or creates an account there, through Google: plain OpenID Connect with PKCE, the transaction between the start and the callback held in one signed cookie, and the callback handing the app a sixty-second single-use token in a URL fragment, exchanged for a session the way the verification link's is ([`mail-flows.md`](mail-flows.md)). Staff have no federated sign-in. Where the refresh token travels afterwards is [`csrf-and-cookies.md`](csrf-and-cookies.md); which ways into an account exist is on `me` ([`auth-sessions.md`](auth-sessions.md)) and on the profile ([`users-and-profile.md`](users-and-profile.md)). An account links and unlinks Google itself, sets a password by a mailed link, and loses every identity to a reset it did not ask for from a session.

## Requirement: A person signs in through Google

`POST /api/v1/public/auth/google/start` takes a JSON body — anything else is `400 VALIDATION_ERROR` — and answers `200 { authorizationUrl }`: Google's authorization endpoint carrying a fresh `state`, `nonce` and PKCE `S256` challenge. It sets `__Host-machxi.oidc` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, ten minutes), whose value is the signed transaction. `GET /api/v1/public/auth/google/callback` spends that transaction on every outcome and answers `302` to `${CUSTOMER_APP_URL}/auth/google` with either `#token=<handoff>` or `#error=<code>` and nothing else in the fragment. On a refusal it clears the cookie; on a sign-in it replaces it with the **handoff binding**, which names the token and lives as long as it does. It resolves the person Google vouched for in this order: **by subject**, whatever address either side now carries; **by address**, only when Google says the address is verified, Google hosts the mailbox, and a live `active` account holds it — which links the identity to that account; **by creation**, only when Google says the address is verified — whether or not Google hosts it — no account holds it, and `FEATURE_USER_REGISTRATION` is on — an `active` account with no password, its address stamped proven, its personal organization and the identity, in one commit. `POST /api/v1/public/auth/google/exchange { token }` answers only in the browser holding the binding for that token: it spends the handoff once and answers `200` with login's body on whichever transport the caller asked for, and clears the cookie. A spent, expired, unknown or unbound token, or one whose account is no longer `active`, answers `401 UNAUTHENTICATED`.
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

### Scenario: An address Google does not host, held by an account

- **WHEN** Google says a verified address it does not host belongs to the person, and a live account holds it
- **THEN** the answer is `#error=AUTH_FEDERATED_LINK_REQUIRED` and nothing is linked — the person signs in with the password and links Google from the account

### Scenario: An address Google does not host, held by nobody

- **WHEN** Google says a verified address it does not host belongs to the person, nobody holds it, and registration is on
- **THEN** an `active` account with no password and one Google identity is created, and the answer is `#token=…` — the mailbox can still recover it, because a reset removes every identity

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

## Requirement: An account keeps its ways in under its owner's control

`POST /api/v1/user/profile/identities/google/start` is the sign-in's start for an account that is signed in: a JSON body or nothing, answering `200 { authorizationUrl }` and setting the same transaction cookie, which now carries the account and the session that asked. Its callback **links** instead of signing in: the Google account joins the caller's account — its address need not match — with an `account.identity_linked { provider, via: "link" }` row, and the answer is `302 …/auth/google#linked=google` with no token and the cookie cleared. It links only while the session that asked is still live and not impersonated; a Google account another account signs in with is `#error=AUTH_IDENTITY_TAKEN`; one the caller already holds is linked again as a no-op; a second Google account on an account that has one is `#error=CONFLICT`. `DELETE /api/v1/user/profile/identities/:provider { currentPassword }` answers `409 AUTH_LAST_CREDENTIAL` when the account has no password, `403 AUTH_CURRENT_PASSWORD_INVALID` when the password does not verify, `404 NOT_FOUND` when nothing of that provider is linked, and otherwise `204`, removing the identity with an `account.identity_unlinked { provider, via: "unlink" }` row and leaving every session as it was. Both routes, and the set-password link below, answer `403 AUTH_IMPERSONATION_REFUSED` on an impersonated session. The link start exists only where the Google client is configured; unlink is mounted everywhere.
Records: [ADR-0072](../adr/0072-federated-identity-google-sign-in.md), [ADR-0057](../adr/0057-impersonation-sessions.md), [ADR-0027](../adr/0027-credential-self-service-and-reset.md), [ADR-0058](../adr/0058-append-only-audit-log.md)
Proved by: `apps/api/test/federated-identity.int.test.ts`, `apps/api/src/modules/auth/__tests__/auth.federated.service.test.ts`, `apps/api/src/core/oidc/__tests__/transaction.test.ts`

### Scenario: The link start

- **WHEN** a signed-in account posts the link start
- **THEN** the answer is `200 { authorizationUrl }` and the transaction cookie is set `SameSite=Lax`

### Scenario: Linking Google from the account

- **WHEN** the callback for a link start carries a Google account nobody here signs in with
- **THEN** exactly one identity is written for the caller, an `account.identity_linked` row says `via: "link"`, and the answer is `302 …/auth/google#linked=google` with no token and no binding

### Scenario: A Google account another account uses

- **WHEN** the callback for a link start carries a Google account already linked to somebody else
- **THEN** the answer is `#error=AUTH_IDENTITY_TAKEN` and nothing is written

### Scenario: A second Google account

- **WHEN** an account that already has a Google identity links a different Google account
- **THEN** the answer is `#error=CONFLICT`, the first identity stays and the second is not written — the owner unlinks the old one first

### Scenario: The same Google account again

- **WHEN** an account links the Google account it already holds
- **THEN** the answer is `#linked=google` and nothing new is written

### Scenario: The session ended before the callback

- **WHEN** the session that started a link is revoked before Google sends the browser back
- **THEN** the answer is `#error=UNAUTHENTICATED` and nothing is linked — a reset that ends the session is not followed by the link it started

### Scenario: The last way in

- **WHEN** an account with no password unlinks Google
- **THEN** the answer is `409 AUTH_LAST_CREDENTIAL` and the identity stays

### Scenario: Unlinking with the wrong password

- **WHEN** an account with a password unlinks Google with a `currentPassword` that does not verify
- **THEN** the answer is `403 AUTH_CURRENT_PASSWORD_INVALID` and the identity stays

### Scenario: Unlinking

- **WHEN** an account with a password unlinks Google with the right `currentPassword`
- **THEN** the answer is `204`, the identity is gone, an `account.identity_unlinked` row names the account as actor with `via: "unlink"`, the caller's session still answers, and a second unlink is `404 NOT_FOUND`

### Scenario: Support opens the account

- **WHEN** an impersonated session posts the link start, unlinks, or asks for a set-password link
- **THEN** each answers `403 AUTH_IMPERSONATION_REFUSED` and nothing changes, while the account's own session may do all three

### Scenario: No client, still a way out

- **WHEN** the API runs without the Google client
- **THEN** the link start answers `404 ROUTE_NOT_FOUND`, and unlink still answers as above

## Requirement: A reset recovers the account from every way in

A password written without the account's own authority removes every federated identity of the account, in the transaction that writes it, with one `account.identity_unlinked` row each saying `via: "reset"`: the reset by mail (`POST /api/v1/user/auth/password/reset` consuming a link `forgot` sent) and the administrative reset (`POST /api/v1/admin/users/:id/password`). A change of password made with the current one removes nothing. `POST /api/v1/user/profile/password/set-link` is for a signed-in account **without a password**: it answers `202 { accepted: true }` and mails the reset link to the account's own address, and an account that has a password is answered `409 CONFLICT` and mailed nothing. The `reset` that consumes **that** link sets the password and keeps the identities **linked before the session that asked for it began**, removing any linked after it — and all of them when that session's row no longer exists. The reset by mail's `account.password_reset` row says `{ requestedBy: "mailbox" | "session", unlinked: [<provider>…] }`. Both resets also spend any Google handoff of the account not yet exchanged. A link callback, a sign-in through an identity already linked, and a reset of one account serialise on the account's row: whichever comes second sees what the first committed, so no identity — and no handoff — outlives a reset it raced. Asking for a set-password link is limited to `RATE_LIMIT_PASSWORD_RESET_MAX` an hour per account, in a counter of its own.
Records: [ADR-0072](../adr/0072-federated-identity-google-sign-in.md), [ADR-0071](../adr/0071-mail-flows.md), [ADR-0027](../adr/0027-credential-self-service-and-reset.md), [ADR-0058](../adr/0058-append-only-audit-log.md)
Proved by: `apps/api/test/federated-identity.int.test.ts`, `apps/api/test/rate-limit.int.test.ts`

### Scenario: A reset by mail

- **WHEN** an account with a password and a Google identity resets its password from a link `forgot` sent
- **THEN** the answer is `204`, the identity is gone, an `account.identity_unlinked` row names the account as actor with `via: "reset"`, and the Google account no longer resolves to anybody

### Scenario: A reset by an operator

- **WHEN** an admin resets the password of an account with a Google identity
- **THEN** the answer is `204`, the identity is gone, and an `account.identity_unlinked` row carries the account as its subject with `via: "reset"`

### Scenario: A change with the current password

- **WHEN** an account with a Google identity changes its password with the current one
- **THEN** the identity stays

### Scenario: Setting a password from the account

- **WHEN** a signed-in account with no password asks for the set-password link and the link is consumed by `reset`
- **THEN** `set-link` answered `202 { accepted: true }`, one message carried a `…/reset-password#token=…` link, the new password signs in, the Google identity the account was made with — older than the session that asked — is still there with no `account.identity_unlinked` row, and the `account.password_reset` row says `{ requestedBy: "session", unlinked: [] }`

### Scenario: An account that already has a password

- **WHEN** a signed-in account with a password asks for the set-password link
- **THEN** the answer is `409 CONFLICT` and nothing is mailed — it changes its password with the current one

### Scenario: An identity younger than the session that asked

- **WHEN** a set-password link is consumed and an identity of the account was linked after the session that asked for the link began
- **THEN** that identity is removed with an `account.identity_unlinked { provider, via: "reset" }` row, and the `account.password_reset` row says `{ requestedBy: "session", unlinked: ["google"] }` — a session in the wrong hands cannot keep its own Google account through the owner's click

### Scenario: The session that asked is gone

- **WHEN** a set-password link is consumed after the row of the session that asked for it has been removed
- **THEN** every identity of the account is removed — nothing is kept on the word of a session that cannot say when it began

### Scenario: A reset by mail, on the trail

- **WHEN** an account with a Google identity resets its password from a link `forgot` sent
- **THEN** the `account.password_reset` row says `{ requestedBy: "mailbox", unlinked: ["google"] }`

### Scenario: A link and a reset at the same moment

- **WHEN** a link callback and a reset of the same account run at once
- **THEN** they take turns on the account's row: a link that waits on a reset finds its session revoked and links nothing, and a reset that waits on a link removes the identity the link committed

### Scenario: A Google sign-in at the moment of a reset

- **WHEN** a sign-in through the account's Google identity runs beside a reset of the account, or has left a handoff not yet exchanged when the reset commits
- **THEN** a sign-in that waits on the reset finds its identity gone and answers `#error=UNAUTHENTICATED` with no token, and a handoff minted before the reset answers the exchange `401 UNAUTHENTICATED`

### Scenario: Asking for set-password links repeatedly

- **WHEN** one account asks for the set-password link more than `RATE_LIMIT_PASSWORD_RESET_MAX` times in an hour
- **THEN** the next ask answers `429 RATE_LIMITED`, while `forgot` for the same address answers on its own budget

## Requirement: The transaction cookie is signed under a key of its own

The transaction cookie and the handoff binding are signed under `OIDC_TRANSACTION_SECRET` when it is set, and otherwise under a key derived from `JWT_ACCESS_SECRET` under a label of its own — never under the access token's key. A value signed under the access key opens to nothing, so it is answered as a callback this browser did not start. Changing either secret fails only the sign-ins in flight at that moment.
Records: [ADR-0078](../adr/0078-backend-closing-wave.md), [ADR-0072](../adr/0072-federated-identity-google-sign-in.md)
Proved by: `apps/api/src/core/oidc/__tests__/transaction.test.ts`, `apps/api/src/core/config/__tests__/config.test.ts`

### Scenario: A transaction under the access token's key

- **WHEN** a cookie value is signed under `JWT_ACCESS_SECRET`, however well formed its claims
- **THEN** the codec opens nothing, and the callback redirects with an error exactly as for a callback this browser did not start

### Scenario: The codec's key stated

- **WHEN** `OIDC_TRANSACTION_SECRET` is set equal to either access secret
- **THEN** the API refuses to start, naming the variable

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
