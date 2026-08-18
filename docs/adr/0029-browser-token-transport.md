# ADR-0029: Browser token transport: httpOnly refresh cookie and CSRF

- Status: accepted
- Date: 2026-08-18

> Written as `proposed` and **accepted the same day**. It changes a published contract (`AuthResource`) and moves a security boundary, so it was put up for a decision rather than assumed; [ADR-0025](0025-deliverables.md) rule 3 keeps "agreed" and "built" as separate facts, and this is now agreed and not yet built — `D2.5` implements it. It stays amendable in place while D2 is in progress (ADR-0025 rule 2); once D2 ships it changes only by supersession.

## Context

[ADR-0018](0018-authentication-sessions-and-tokens.md) §Token transport decides v1 and delegates the rest:

> - v1 (API-first, Postman, mobile): access token in `Authorization: Bearer`, refresh token in the JSON body.
> - Browser apps (`web`, `admin`) will move the refresh token to an `httpOnly; Secure; SameSite=Strict` cookie scoped to `/api/v1/{user|admin}/auth/refresh` with CSRF protection — **future ADR**; the auth service is transport-agnostic (the auth service returns tokens; the controller decides body vs cookie).

The delegation is explicit, so this ADR adds a decision ADR-0018 declined to make rather than changing one it made; under [ADR-0024](0024-adr-lifecycle.md) rule 1 no supersession is required.

Two things about the D1 code sharpen the problem.

**The service is transport-agnostic; the contract is not.** `createAuthService` returns an `AuthResource` and knows nothing about HTTP, exactly as ADR-0018 claims. But `AuthResource` is a hand-written type in `@repo/contracts` with a required `refreshToken: string`, and it is what the two frontend apps will import. A controller cannot decide "body vs cookie" while the type it returns insists the token is in the body. The transport change is therefore a contracts change, not only a controller change — which is the part worth knowing before the apps exist rather than after.

**`cors({ credentials: true })` is already set** in `app.ts`, with the comment "needed for future cookie transport" ([ADR-0020](0020-security-baseline.md) §CORS). Today it is inert — nothing sets a cookie — so the repository has already pre-committed to this design without stating it. Either that line is justified by this ADR or it should not be there.

This is a D2 prerequisite rather than a follow-up. The `admin` app cannot be built without knowing where its refresh token lives, and the answer changes `apps/api` (a cookie parser, a CSRF middleware, two controllers) and `packages/contracts`, not just the frontend.

## Decision

### What moves, and what does not

**The refresh token moves to a cookie. The access token does not.**

The access token stays in the response body and travels in `Authorization: Bearer`, held in JavaScript memory by the browser apps. That looks like the weaker half and is the point of the split: a token in memory dies with the tab and is never attached to a request the user did not make, so no endpoint needs CSRF protection. Putting the *access* token in a cookie would make every authenticated route CSRF-relevant, which is a far larger surface than the three endpoints below.

What the cookie buys is the difference between an XSS costing fifteen minutes and an XSS costing thirty days. That is the whole trade, stated plainly: this design does not stop cross-site scripting from acting as the user, it stops it from walking away with a thirty-day credential.

### Opt-in, not inference

Transport is chosen by the client, per request, with a header on `login`, `refresh` and `register`:

```
X-Auth-Transport: cookie | body        (default: body)
```

- `body` — D1 behaviour, unchanged. `refreshToken` is in the response, no cookie is set. Mobile clients, Postman and the integration suite keep working with no edit.
- `cookie` — the controller sets the refresh cookie and **omits `refreshToken` from the response body**. `refresh` then reads the token from the cookie when the body field is absent.

The alternative — inferring "this is a browser" from `Origin` or `User-Agent` — is rejected because both are client-controlled, both are present on non-browser requests, and the failure mode of guessing wrong is a thirty-day credential in a response body that the client did not expect and therefore does not protect. A transport that changes what a response contains must be asked for.

The default is `body` so that this ADR does not break every existing caller on the day it lands.

### The cookie

| Attribute  | Value                                                       |
| ---------- | ----------------------------------------------------------- |
| Name       | `__Secure-machxi.refresh`                                   |
| Value      | the opaque refresh token (`randomToken(32)`, as today)      |
| `HttpOnly` | yes                                                          |
| `Secure`   | yes, always                                                  |
| `SameSite` | `Strict`                                                     |
| `Path`     | `/api/v1/user/auth` or `/api/v1/admin/auth`                  |
| `Max-Age`  | `REFRESH_TOKEN_TTL`                                          |

- **`Path` is per segment**, so a browser signed into both populations holds two cookies that are never sent to each other's endpoints. That is the ADR-0019 §1 separation expressed in the browser rather than only in the router, and it costs nothing.
- **`__Host-` is not used** despite being the stronger prefix: it requires `Path=/`, which would send the refresh token to every endpoint of the API. `__Secure-` gives the prefix guarantee that matters here — the cookie cannot be set over plain HTTP — while allowing the path scope.
- **`Secure` is unconditional, with no environment variable to turn it off.** Browsers treat `http://localhost` as a trustworthy origin and accept `Secure` cookies from it, so local development works; `CORS_ORIGINS` already defaults to `http://localhost:3001,http://localhost:3002` (ADR-0004). Developing against a LAN IP over plain HTTP will not work, and that is the intended answer — a flag that disables `Secure` is a flag that eventually ships enabled.
- **`logout` and `logout-all` clear it**, with the same attributes, or the browser keeps sending a value the server has already revoked and every subsequent refresh spends a `RATE_LIMIT_REFRESH_MAX` failure.
- **Rotation rewrites it.** Reuse detection and the grace window (ADR-0018 §Refresh) are untouched — they operate on the token value, and where the value was carried is not something the service sees.

### CSRF

`SameSite=Strict` already prevents a cross-site request from carrying the cookie, and for a strictly cross-site attacker it is sufficient. It is not the whole threat: a compromised or attacker-controlled subdomain is same-site, and `SameSite` is a browser behaviour rather than a server check.

So the cookie-bearing endpoints also require a **double-submit token**:

- On any response that sets or rotates the refresh cookie, the API also sets `machxi.csrf` — a fresh `randomToken(32)`, `Secure`, `SameSite=Strict`, same `Path`, and **not** `HttpOnly`, because the client must read it.
- `POST /auth/refresh`, `POST /auth/logout` and `POST /auth/logout-all` require `X-CSRF-Token` to equal the `machxi.csrf` cookie **when the request is relying on the refresh cookie**. A request that carries its refresh token in the body is not cookie-driven and is not subject to the check.
- The comparison is constant-time, and a mismatch is `403 CSRF_TOKEN_INVALID`.

The middleware is `core/middleware/csrf.ts` and is applied by the auth routers, alongside `noStore`. It reads cookies and nothing else, so it needs no container dependency.

### Contracts

- `AuthResource.refreshToken` becomes **optional**. Its absence means "the refresh token is in a cookie you cannot read", which is what a browser client should see.
- `refreshBody.refreshToken` becomes optional; the controller supplies the cookie value when it is absent, and a request with neither is a validation error.
- `CSRF_TOKEN_INVALID` (403) joins the error-code union.
- No new environment variable. Cookie names, attributes and the CSRF header are constants in `apps/api`, not configuration — a deployment that needs to change them is a deployment with a different security model.

### What this does not decide

- **Cookie-only authentication**, with no bearer token at all. That is a different architecture and would put CSRF on every route.
- **Content Security Policy** for the two frontend apps. `helmet()`'s defaults apply to API responses, which are JSON; a CSP that matters is one the apps serve, and it belongs with them.
- **Refresh-cookie behaviour for a native mobile client.** Mobile stays on `body` transport and the keychain, as ADR-0018 §Token transport already says.

## Consequences

- An XSS in `web` or `admin` costs an access token, not a session. That is the entire justification, and it is worth restating that it is a reduction in blast radius, not a fix for XSS.
- `cors({ credentials: true })` becomes justified rather than speculative. It also makes `CORS_ORIGINS` load-bearing in a new way: the CORS specification forbids a literal `*` together with credentials, so the wildcard and the cookie cannot both be taken at face value.

  **Amended 2026-08-19 (D2.2).** The sentence this replaces said a wildcard origin "now fails in the browser" and that `*` is "unusable anywhere". Both were wrong about the implementation D2.2 chose. `CORS_ORIGINS=*` is translated to `cors`'s `origin: true`, which **reflects** the request's `Origin` header rather than echoing `*` — and a reflected origin is perfectly valid alongside `credentials: true`, which is exactly why reflection is the standard way to express a wildcard on a credentialed API.

  So `*` keeps working in development, and the consequence is the opposite of what was written: reflecting *any* origin on an API that sets a credential cookie is as open as it sounds, and nothing about this ADR makes the browser stop it. What stops it is ADR-0004's config schema refusing `*` outright when `NODE_ENV=production`, which is the control that was already there. The correct statement is therefore: `*` is a development convenience whose only guard is the production refusal, and this ADR raises the cost of that guard failing rather than adding one of its own.
- Every browser request to `/auth/refresh` grows a header the client must read from a cookie. That is real client complexity, and it is the standard shape of double-submit CSRF; the alternative is trusting `SameSite` alone.
- The integration suite gains a second dimension: the auth flows are already parameterised by population (ADR-0021, amended D1.8), and cookie transport adds a transport axis. The `describe.each` case object is the seam that already exists for this.
- Postman keeps working unchanged, on `body` transport, which keeps the collection usable as documentation of the transport a mobile client would use.
- `AuthResource.refreshToken` becoming optional makes every existing consumer's type slightly weaker. There are no consumers outside this repository yet, which is why this is the moment to do it.
- Two cookies per population, four for a browser signed into both. They are path-scoped, so no request carries more than two.

## Alternatives considered

- **Leave the refresh token in the body and have the SPA hold it in memory**, refreshing on load. Zero server change, and it means a thirty-day credential lives in JavaScript, where any XSS takes it. It is what D1 does and it is defensible for an API-first product; it is not defensible once a first-party browser app is the primary client.
- **Put both tokens in cookies and drop bearer transport for browsers.** Fewer moving parts in the client, and every authenticated endpoint becomes CSRF-relevant. The point of keeping the access token in a header is that it makes CSRF a three-endpoint problem.
- **`SameSite=Strict` with no CSRF token.** Adequate against a purely cross-site attacker and silent against a same-site one. The double-submit token costs one cookie and one header.
- **`SameSite=Lax` instead of `Strict`.** `Lax` exists so that top-level navigations carry a session cookie. Nothing here is a navigation — `/auth/refresh` is only ever reached by `fetch` — so `Lax` buys nothing and permits more.
- **A signed, encrypted session cookie holding the session id** instead of the opaque refresh token. Equivalent security, and it introduces a second credential format and a signing key with its own rotation problem, for a value that is already a 32-byte random token stored only as a SHA-256 digest.
- **Infer transport from the `Origin` header.** No client change at all, and the response body's contents would depend on a header an attacker controls.
