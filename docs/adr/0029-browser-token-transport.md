# ADR-0029: Browser token transport: httpOnly refresh cookie and CSRF

- Status: accepted
- Date: 2026-08-18

> Written as `proposed` and **accepted the same day**. It changes a published contract (`AuthResource`) and moves a security boundary, so it was put up for a decision rather than assumed; [ADR-0025](0025-deliverables.md) rule 3 keeps "agreed" and "built" as separate facts, and this is now agreed and not yet built — `D2.5` implements it. It stays amendable in place while D2 is in progress (ADR-0025 rule 2); once D2 ships it changes only by supersession.
>
> **Amended 2026-08-19 (D2.6).** D2.5 built it and D2 shipped the same day, so the sentence above about it being "not yet built" is history: this ADR is closed, and the amendments dated _2026-08-19 (D2.5)_ below were the last made in the window.

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

**Amended 2026-08-19 (D2.5).** The rule above says transport is chosen "per request, with a header", and on `refresh` that turned out to be a trap rather than a choice.

_A `refresh` that arrives on the cookie is answered on the cookie, header or no header._ A browser that refreshes from its cookie and forgets `X-Auth-Transport` would otherwise be answered with the rotated token **in the body and no new cookie** — so the browser goes on holding the value that was just rotated away. Replaying it is tolerated inside `REFRESH_ROTATION_GRACE_SEC` and is reuse detection outside it, at which point the session is revoked (ADR-0018 §Refresh). A forgotten header would cost the user their session, silently and minutes later, which is a far worse failure than the one the opt-in exists to prevent.

So on `refresh` the presented cookie *is* the opt-in, and the header decides only what a caller who presented nothing gets. This is not the `Origin`-sniffing rejected above: nothing is inferred about the client, and the signal is the credential it actually sent — a request cannot present the refresh cookie without already holding the refresh token. `login` and `register` are unchanged, because there is no credential to read there and the header is the only thing to go on.

The body still wins when both are present, so a client that names its credential explicitly gets a body answer whatever is attached to the request.

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

**Amended 2026-08-19 (D2.5).** The scheme above is right and the cookie it specifies was unusable. Three corrections, all found by the review of the first implementation.

_`machxi.csrf` becomes `__Host-machxi.csrf` at `Path=/`._ The rule above gives it "same `Path`" as the refresh cookie, and that makes it **unreadable by the client it exists for**: `document.cookie` returns only cookies whose path matches the *document's* URL, so an app served from `/` or `/dashboard` never sees a token scoped to `/api/v1/admin/auth`. As specified, the double-submit could only ever fail, and the first thing anyone building `admin` would have done is weaken or delete the check. `Path=/` fixes it and makes the `__Host-` prefix free, which is worth having in its own right — see below.

_The token is also returned in the response body on cookie transport, as `AuthResource.csrfToken`._ The cookie copy is what a page re-reads after a reload; the body copy is for an app served from a different host than the API — `app.example.com` against `api.example.com` — which is same-*site* enough for `SameSite=Strict` to send the refresh cookie but can never read the API's cookies from `document.cookie`. That is the deployment `CORS_ORIGINS` and `credentials: true` exist for, so it cannot be the one the CSRF scheme excludes. The value grants nothing on its own: it proves only that the sender could read a response or a cookie from this origin, which a cross-site attacker cannot.

_A cookie name that appears twice is treated as absent._ `__Secure-` constrains the scheme, not the host, so a sibling subdomain that can set `Domain=example.com` cookies may plant a second cookie of either name; RFC 6265 §5.4 orders the `Cookie` header by descending path length, so **the attacker chooses which one a first-match reader sees**. On `machxi.csrf` that hands them both halves of the double-submit; on the refresh cookie it is session fixation, and the shadow keeps winning every rotation because the API's own cookie is host-only at a shorter path. `readCookie` therefore fails closed on a duplicate — the request is answered as though no cookie were sent, which costs a real client a re-login and costs the attacker the attack. `__Host-` closes it outright for the CSRF cookie; the refresh cookie cannot take that prefix without giving up its path scope, so fail-closed is its only defence and the deployment constraint below is the rest of it.

The middleware is `core/middleware/csrf.ts` and is applied by the auth routers, alongside `noStore`. It reads cookies and nothing else, so it needs no container dependency.

### Contracts

- `AuthResource.refreshToken` becomes **optional**. Its absence means "the refresh token is in a cookie you cannot read", which is what a browser client should see.
- `refreshBody.refreshToken` becomes optional; the controller supplies the cookie value when it is absent, and a request with neither is a validation error.
- `CSRF_TOKEN_INVALID` (403) joins the error-code union.
- No new environment variable. Cookie names, attributes and the CSRF header are constants in `apps/api`, not configuration — a deployment that needs to change them is a deployment with a different security model.

**Amended 2026-08-19 (D2.5).** Where those constants live, and one thing the change needed that this section did not anticipate.

_The names are in `core/http/cookies.ts`, not in the auth module._ Two things need them and they sit on opposite sides of the dependency rule: the auth controller writes the cookies, and `core/middleware/csrf.ts` reads them. Core may not import a module (ADR-0009), so the shared constant lives in core and the auth module keeps only the *writing* — attributes, clearing, and the transport decision.

_There is no `cookie-parser`._ §Context lists "a cookie parser" among what changes in `apps/api`, and what landed is a twenty-line `readCookie` rather than a dependency: `res.cookie` is already built into Express, this API reads exactly two cookies, and both hold base64url values it set itself. The two edges that make a naive parser wrong are tested — a value containing `=`, and a name that is a suffix of another name, so `evil.machxi.csrf` cannot answer for `machxi.csrf`.

_`validate` now treats an absent body as `{}`._ Not a contracts change and not a new decision, but it is here because of this one: `fetch(url, { method: "POST" })` — what a browser refreshing from its cookie sends — carries no body and no content type, so Express leaves `req.body` undefined and `refreshBody`, whose every field is now optional, was rejected before the controller could look at the cookie. A schema with required fields is unaffected apart from reporting which fields are missing rather than "expected object, received undefined".

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

  **Amended 2026-08-19 (D2.5).** Three per population, and the CSRF one is now shared: `__Host-machxi.csrf` is at `Path=/`, so a browser signed into both populations holds one CSRF cookie and two refresh cookies. The last write wins, which is correct — the token is not a credential and any current value satisfies the check.

**Amended 2026-08-19 (D2.5).** What the implementation and its review added to this list.

- **The refresh limiter now counts only `401`.** It runs before `csrfGuard`, is keyed on IP alone, and `skipSuccessfulRequests` charged every non-2xx — so a `403 CSRF_TOKEN_INVALID` or a `400` empty body counted against the budget. Any web page could `fetch` `/auth/refresh` five times and lock a visitor out, and on cookie transport a locked-out browser has no token in JavaScript to retry with: the session ends at the next access-token expiry. `requestWasSuccessful: (_req, res) => res.statusCode !== 401` narrows it to what ADR-0020 meant by "failed refreshes".
- **The body exemption belongs to `refresh` alone.** §CSRF exempts "a request that carries its refresh token in the body", which is a description of `refresh`; `logout` and `logout-all` read no body at all, so a `refreshToken` field in one of those is only ever a request to skip the check. The guard is a factory (`createCsrfGuard({ allowBodyToken })`) and the two logout routes take the default.
- **`CSRF_TOKEN_INVALID` is unprefixed and grouped with the auth codes.** ADR-0013 prefixes codes owned by a module (`AUTH_`, `USER_`, `STAFF_`) and leaves generic ones bare; this one is raised by core middleware, which its taxonomy has no group for. The name follows the rule and the array entry sits with the endpoints it guards.
- **`validate` treating an absent body as `{}` widened exactly one schema.** Every other all-optional body — `updateStaffBody`, `updateStaffProfileBody`, `updateUserBody`, `updateProfileBody` — carries `.refine(Object.keys(body).length > 0)`, so `{}` still fails there; `refreshBody` is the only one whose acceptance changed. That is what makes the change safe, and it is one missing `.refine` away from stopping being true.

**Deployment constraints this creates, and what is still open.**

- **Cookie transport requires the app and the API to be same-_host_, not merely same-site.** Two attributes set that bar together, and only the first was obvious. `SameSite=Strict` means the refresh cookie is sent only when the two share a registrable domain, so an SPA on `app.vercel.app` against `api.machxi.io` never refreshes at all. The second is `document.cookie`: it returns only cookies of the document's **own host**, so `app.example.com` cannot read a `__Host-` cookie set by `api.example.com` even though the two are same-site and the refresh cookie is sent happily between them.

  That matters because of what a reload leaves behind. Both the access token and the body copy of the CSRF token live in memory by design, so after a refresh of the page the only credential the client still holds is the cookie the browser keeps for it — and on a cross-host deployment it cannot read the CSRF token it must echo. The refresh would be a `403` and the user would have to log in again. Same-host has no such gap: the token is at `Path=/` on the host the app is served from, so a reloaded page reads it straight back.

  So the supported shape is: **the app and the API behind one host** — one reverse proxy, or the API mounted under the app's origin — for cookie transport, and `body` transport for everything else, which is what a mobile client uses and what Postman documents. This is a deployment constraint rather than a code path, which is exactly why it belongs in the record: nothing in the API can detect it, and the failure it produces is a `403` on a page reload that looks like a bug in the client.
- **No untrusted host under that registrable domain.** The fail-closed duplicate rule turns a shadowing attempt into a denial of service rather than a compromise, which is the best a path-scoped cookie can do. A deployment that cannot make that promise should not enable cookie transport.
- **Lifting the same-host constraint needs an endpoint this ADR does not add.** A `GET /auth/csrf` that sets the cookie and returns the token would let a cross-host app bootstrap after a reload, because it is the one request in the flow that cannot itself require a CSRF token. It is a new endpoint with its own questions — may it be called unauthenticated, what does it cost, is it cacheable — so it is listed under _Planned_ in the ADR index rather than decided in passing here. Until it exists, a cross-host deployment uses `body` transport.
- **The refresh cookie is not cleared when the server kills the session.** `logout` and `logout-all` clear both cookies; a refresh that fails with `AUTH_REFRESH_REUSED`, `AUTH_SESSION_REVOKED` or `AUTH_ACCOUNT_DISABLED` leaves the browser replaying a dead thirty-day cookie until it expires. Fixing it means a controller that inspects an error before rethrowing, which ADR-0013 keeps out of controllers, so it is recorded rather than done.

## Alternatives considered

- **Leave the refresh token in the body and have the SPA hold it in memory**, refreshing on load. Zero server change, and it means a thirty-day credential lives in JavaScript, where any XSS takes it. It is what D1 does and it is defensible for an API-first product; it is not defensible once a first-party browser app is the primary client.
- **Put both tokens in cookies and drop bearer transport for browsers.** Fewer moving parts in the client, and every authenticated endpoint becomes CSRF-relevant. The point of keeping the access token in a header is that it makes CSRF a three-endpoint problem.
- **`SameSite=Strict` with no CSRF token.** Adequate against a purely cross-site attacker and silent against a same-site one. The double-submit token costs one cookie and one header.
- **`SameSite=Lax` instead of `Strict`.** `Lax` exists so that top-level navigations carry a session cookie. Nothing here is a navigation — `/auth/refresh` is only ever reached by `fetch` — so `Lax` buys nothing and permits more.
- **A signed, encrypted session cookie holding the session id** instead of the opaque refresh token. Equivalent security, and it introduces a second credential format and a signing key with its own rotation problem, for a value that is already a 32-byte random token stored only as a SHA-256 digest.
- **Infer transport from the `Origin` header.** No client change at all, and the response body's contents would depend on a header an attacker controls.
