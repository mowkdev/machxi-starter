# Cookie transport, CSRF and CORS

A browser client may ask for the refresh token to travel in a cookie rather than the body. When it does, the token is `HttpOnly`, scoped to the segment's auth path, and every cookie-driven request that leans on it must prove intent with a double-submit CSRF token that is one per population. Every name is derived from `APP_ID`.

## Requirement: Cookie transport is an explicit opt-in

`POST /auth/login`, `/auth/refresh`, `/auth/impersonate` and `/public/auth/register` answer on body transport unless the request carries `X-Auth-Transport: cookie`. On cookie transport the refresh token is removed from the body and set as `__Secure-<app>.refresh` — `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/api/v1/{admin,user}/auth`, `Max-Age` equal to the refresh token's TTL — and a CSRF token is set beside it as `__Host-<app>.csrf.{admin,user}` at `Path=/`, readable by script, and echoed in the body as `csrfToken`. Nothing about the client is inferred; only the header decides.
Records: [ADR-0029](../adr/0029-browser-token-transport.md), [ADR-0056](../adr/0056-per-population-csrf-cookie.md), [ADR-0064](../adr/0064-brand-seams.md)
Proved by: `apps/api/test/auth-cookie.int.test.ts`, `apps/api/src/core/http/__tests__/cookies.test.ts`

### Scenario: Body transport by default

- **WHEN** a client logs in without the transport header
- **THEN** the refresh token is in the body and no `Set-Cookie` is sent

### Scenario: Cookie transport on request

- **WHEN** a client logs in with `X-Auth-Transport: cookie`
- **THEN** the body carries `accessToken` and `csrfToken` and no `refreshToken`, and two `Set-Cookie` headers carry the refresh cookie on the segment's path and the population's CSRF cookie at `/`

### Scenario: A refresh from the cookie stays on cookie transport

- **WHEN** a request to `/auth/refresh` carries no body token and the refresh cookie, with or without the transport header
- **THEN** the rotated token is set as a new cookie rather than returned in the body, so the browser never holds a token that was just rotated away

## Requirement: A cookie-driven request proves intent

`refresh`, `logout` and `logout-all` accept a request that relies on the refresh cookie only when `X-CSRF-Token` matches this population's CSRF cookie, compared in constant time. A request that presents its refresh token in the body is not cookie-driven and is not checked. A refusal is `403 CSRF_TOKEN_INVALID`: the session is fine, the request's integrity is not.
Records: [ADR-0029](../adr/0029-browser-token-transport.md), [ADR-0056](../adr/0056-per-population-csrf-cookie.md)
Proved by: `apps/api/test/auth-csrf.int.test.ts`

### Scenario: Cookie without the header

- **WHEN** the refresh cookie is sent and `X-CSRF-Token` is absent or does not match the population's cookie
- **THEN** the answer is `403 CSRF_TOKEN_INVALID` and nothing is rotated or revoked

### Scenario: The other population's token

- **WHEN** a browser signed into both apps sends the admin CSRF token on a user-segment request
- **THEN** the answer is `403 CSRF_TOKEN_INVALID` — each segment checks its own cookie and no other

### Scenario: Body token exempts

- **WHEN** `refresh` carries a refresh token in the body
- **THEN** no CSRF token is required, whatever cookies are attached

## Requirement: The bootstrap endpoint issues without rotating

`GET /auth/csrf` is unauthenticated, takes no input and answers `200 { csrfToken }`, setting this population's CSRF cookie. It echoes a token the caller already holds rather than minting a new one, so a cross-site navigation to it cannot invalidate a signed-in victim's token.
Records: [ADR-0030](../adr/0030-csrf-bootstrap-endpoint.md), [ADR-0056](../adr/0056-per-population-csrf-cookie.md)
Proved by: `apps/api/test/auth-csrf.int.test.ts`

### Scenario: First call

- **WHEN** a client with no CSRF cookie calls the bootstrap
- **THEN** the answer carries a fresh token in the body and the same value in this population's cookie

### Scenario: Repeat call

- **WHEN** a client that already holds this population's cookie calls the bootstrap
- **THEN** the answer echoes that value, unchanged

## Requirement: Logout clears this population's cookies and no other's

`logout`, `logout-all` and the user's self-deletion clear the refresh cookie and this population's CSRF cookie with the attributes they were set with, and leave the other population's cookies untouched.
Records: [ADR-0056](../adr/0056-per-population-csrf-cookie.md), [ADR-0029](../adr/0029-browser-token-transport.md)
Proved by: `apps/api/test/auth-cookie.int.test.ts`, `apps/api/test/auth-csrf.int.test.ts`

### Scenario: Signed into both apps

- **WHEN** the user segment's `logout` is called by a browser holding both populations' cookies
- **THEN** the user refresh and CSRF cookies are expired and the admin cookies are not mentioned

## Requirement: A shadowed cookie reads as absent

A `Cookie` header that carries the same name twice yields nothing for that name — the request is treated as though the cookie were not present — so a sibling subdomain that can set domain cookies cannot choose which value the API reads.
Records: [ADR-0029](../adr/0029-browser-token-transport.md)
Proved by: `apps/api/src/core/http/__tests__/cookies.test.ts`

### Scenario: Two refresh cookies

- **WHEN** a request carries `__Secure-<app>.refresh` twice
- **THEN** a cookie-driven refresh answers as if no cookie were sent, and no rotation happens

## Requirement: Cross-origin access follows the allow-list

Only origins listed in `CORS_ORIGINS` receive `Access-Control-Allow-Origin` and may send credentials; a request from any other origin gets no CORS headers, and the browser refuses the response.
Records: [ADR-0020](../adr/0020-security-baseline.md)
Proved by: `apps/api/test/cors.int.test.ts`

### Scenario: An allowed origin

- **WHEN** a preflight arrives from a listed origin
- **THEN** the answer allows that origin, credentials, and the `X-Auth-Transport`, `X-CSRF-Token` and `Authorization` headers

### Scenario: Any other origin

- **WHEN** a request carries an `Origin` that is not listed
- **THEN** the response carries no `Access-Control-Allow-Origin`
