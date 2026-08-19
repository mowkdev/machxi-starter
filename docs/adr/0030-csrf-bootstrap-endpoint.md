# ADR-0030: CSRF bootstrap endpoint (`GET /auth/csrf`)

- Status: accepted
- Date: 2026-08-19

> Written for D3 ("Admin panel", opened 2026-08-19), whose plan names `D3.2` as the implementing step. It stays amendable in place while D3 is in progress ([ADR-0025](0025-deliverables.md) rule 2).

## Context

[ADR-0029](0029-browser-token-transport.md) shipped cookie transport with a deployment constraint it named honestly: **same-host only**. `SameSite=Strict` is satisfied by any same-site pair, so `admin.example.com` against `api.example.com` sends the refresh cookie happily — but `document.cookie` returns only cookies of the document's *own host*, so that app can never read `__Host-machxi.csrf`, which the API's host set. And after a page reload there is nothing else to fall back on: both the access token and the body copy of the CSRF token live in memory by design, so the only credential a reloaded page still holds is a refresh cookie it cannot satisfy the CSRF check for. The refresh answers `403 CSRF_TOKEN_INVALID` and the user logs in again.

ADR-0029 §Consequences also named the way out — "a `GET /auth/csrf` that sets the cookie and returns the token would let a cross-host app bootstrap after a reload, because it is the one request in the flow that cannot itself require a CSRF token" — and then deliberately did not build it: "it is a new endpoint with its own questions — may it be called unauthenticated, what does it cost, is it cacheable — so it is listed under _Planned_ in the ADR index rather than decided in passing here."

That delegation is explicit, so this ADR **adds** a decision ADR-0029 declined to make rather than changing one it made; under [ADR-0024](0024-adr-lifecycle.md) rule 1 no supersession is required — the same reasoning ADR-0029 itself used against ADR-0018 §Token transport.

Why now: D3's admin app targets the blueprint's reference deployment of subdomains — `admin.example.com` against `api.example.com`. That is same-*site*, so the refresh cookie flows, and cross-*host*, so the CSRF cookie is unreadable — exactly the shape ADR-0029 excludes. Until this endpoint exists, the admin app's choices are `body` transport (a thirty-day credential in JavaScript, which ADR-0029 rejected for first-party browser apps) or a forced re-login on every reload. Neither is a way to build a panel.

## Decision

### The endpoint

```
GET /api/v1/user/auth/csrf
GET /api/v1/admin/auth/csrf
```

One per segment, on the existing auth routers ([ADR-0015](0015-route-segments-and-versioning.md)) — mounted **above** `authenticate(population)`, with `login` and `refresh`, under the router-wide `noStore`:

```ts
// modules/auth/auth.routes.ts — before the authenticate() line
router.get("/csrf", controller.csrf);
```

Per-segment paths are what the refresh cookie's `Path` scoping already implies — everything a browser does with its refresh credential happens under `/api/v1/{user,admin}/auth`. But the CSRF cookie itself is host-wide at `Path=/` (ADR-0029, amended D2.5), so, said plainly: **either segment's endpoint yields a token valid for both populations.** The two routes exist for symmetry and for the router factory that already serves both segments, not because the tokens differ.

### Unauthenticated, and why that is safe

The endpoint requires no principal. Two reasons, one of principle and one of necessity:

- **The token grants nothing on its own.** It proves only that the sender could read a response from this origin, which is precisely the double-submit property ADR-0029 already relied on when it put `csrfToken` in the response body of `login` and `refresh`. An attacker who calls this endpoint gets a token — for *their own* client, matched to *their own* cookie jar. It moves them nowhere: the thing the CSRF check defends is the refresh cookie, which this endpoint neither reads nor sets.
- **Requiring auth would be circular.** Bootstrap runs at the exact moment the client holds no access token — that is what a reload leaves behind, and the whole reason the endpoint exists. An authenticated `GET /auth/csrf` is an endpoint nothing could ever call.

D3.2's tests record it as deliberately unauthenticated — [ADR-0019](0019-authorization-guards.md)'s guard-matrix discipline applied to the auth routers, whose existing suites carry no such matrix — so the next reader finds a decision rather than an omission.

### What it does

It sets `__Host-machxi.csrf` with the same attributes ADR-0029 gives it, **and** returns the same value in the envelope body:

```ts
// modules/auth/auth.cookies.ts — one writer, two policies
export const setCsrfCookie = (res: Response, maxAgeSec: number): string => { /* always mints */ };
export const ensureCsrfCookie = (req: Request, res: Response, maxAgeSec: number): string => { /* echoes, else mints */ };

// modules/auth/auth.controller.ts
csrf: (req: Request, res: Response): void => {
  respond.ok<CsrfResource>(res, { csrfToken: ensureCsrfCookie(req, res, refreshTtlSec) });
},
```

**Amended 2026-08-19 (D3.2)** on two points the first draft got wrong, both found while building it.

_The cookie's `Max-Age` is `REFRESH_TOKEN_TTL`, and the writer takes it as a parameter._ "The same attributes ADR-0029 gives it" is the binding sentence, and ADR-0029 §CSRF does not actually name this one — its `Max-Age` row belongs to the refresh cookie, and the CSRF cookie inherited the same value only because D2.5's `setAuthCookies` wrote both from one variable. So the attribute is stated here, which is the one place that can state it while ADR-0029 stays frozen. A parameterless `setCsrfCookie(res)` would have issued a *session* cookie from the bootstrap and a thirty-day one from login: the same code path, two different cookies, and a reloaded browser finding nothing exactly when it needs it.

_The bootstrap echoes an existing token instead of rotating._ The paragraph below said last-write-wins was fine, and it was — while only `login` and `refresh` rotated, because no third party can trigger either. This endpoint is different in kind: unauthenticated, no input, plain `GET`, so it is reachable **in the operator's own browser** from a page they did not mean to visit. A bootstrap that rotated unconditionally would let that page replace a signed-in operator's cookie, leaving the value their tab holds in memory stale, so their next refresh answers `403 CSRF_TOKEN_INVALID` and — under ADR-0033's terminal codes — ends the session. That is a cross-site forced logout, which is the class of thing the CSRF token exists to prevent, so the endpoint is idempotent instead: `ensureCsrfCookie` re-sends the token the caller already holds and mints only when there is none. An unintended call becomes a no-op.

Two notes on the reach of that, because the fix is worth more than the analysis behind it. `SameSite=Strict` governs whether the cookie is *sent*, and RFC 6265bis also gates *storing* one on the request's same-site status, so a plain cross-site subresource load may well be unable to write the cookie at all; a cross-site **top-level navigation** is the vector that clearly can, and any host under the registrable domain can — the sibling ADR-0029 already refuses to allow. **Which of those a given browser permits was not established here** — an honest test needs two real domains and TLS, since `Secure` and `__Host-` do not survive a plain-HTTP alias. The idempotent bootstrap makes the question moot, which is why it was preferred over the alternative of writing "re-bootstrap once on `403`" into the client that does not exist yet.

Echoing discloses nothing new: the cookie is already readable by any page on the API's host, which is what `httpOnly: false` is for, and the body is opaque to any origin outside the CORS allow-list. A duplicate or shadowed cookie reads as absent (`readCookie` fails closed, ADR-0029 §CSRF) and therefore mints, which is the right way round — the client ends up holding one unambiguous value it can echo rather than a shadowed one it cannot.

Both copies for the same two moments ADR-0029 §CSRF (amended D2.5) already distinguished: the cookie is what a same-host page reads back after a reload; the body is the only copy a cross-host app can ever see.

**Rotation is last-write-wins, and that is fine.** A browser with two tabs, or signed into both populations, may race a bootstrap against a login; whichever `Set-Cookie` lands last wins. ADR-0029's amendment already established the ground for this: the CSRF token is not a credential, and any current value satisfies the check. A client that echoes the value from the response it actually received matches the cookie that response set.

**Amended 2026-08-19 (D3.2).** With the bootstrap idempotent, the only writers that rotate are `login` and `refresh`, so the race narrows to what it was before this endpoint existed — and two tabs bootstrapping now converge on one value rather than fighting over two. It does not vanish: a login in one tab still rotates the cookie under a second tab holding the old value in memory, and that tab's next cookie-driven request answers `403 CSRF_TOKEN_INVALID`. **That `403` is recoverable, and the client must treat it as such** — re-bootstrap and retry once, rather than ending the session. [ADR-0033](0033-browser-api-client-and-session.md) listed `CSRF_TOKEN_INVALID` among its terminal codes, which this endpoint's idempotence falsified; it was **reconciled the same day** — ADR-0033 §Boot and ADR-0036, both amended D3.2 — so D3.4 builds the recovery rather than discovering the need for it.

**The response is never cacheable.** `noStore` already applies router-wide (ADR-0020, amended step 10), so no code changes for this — but it is a requirement here, not an inherited nicety: a cached response would hand back a token the accompanying `Set-Cookie` never reached the browser with, and the mismatch is a `403` that looks like a client bug. If the router-wide `no-store` is ever revisited, this route keeps it.

### Rate limiting

The global limiter (`300 / 15 min / IP`, [ADR-0020](0020-security-baseline.md)) covers it, and nothing stricter is added. It must **not** count against the refresh limiter — that budget is for guessing at opaque tokens (ADR-0020; narrowed to count only `401` by the D2.5 change recorded in ADR-0029 §Consequences), and a bootstrap presents nothing to guess. The cost of a call is one `randomToken(32)` and a header write — cheap by design, no database, no hash pool. And honestly: an attacker gains nothing by hammering it. Each call buys a token that is only good with the cookie jar it was issued into; a million of them are a million answers to a question nobody asked.

### Contracts

A new minimal resource type in `@repo/contracts` `auth/`, hand-written like its siblings ([ADR-0023](0023-shared-contracts-package.md)):

```ts
export interface CsrfResource {
  readonly csrfToken: string;
}
```

`AuthResource` is unchanged. No request schema — the endpoint takes no params, query or body. No new error code, no new environment variable.

### The client protocol this enables

The browser client ([ADR-0033](0033-browser-api-client-and-session.md), authored in parallel) boots with no token in memory and runs:

```
GET  /auth/csrf                          → { csrfToken }
POST /auth/refresh  (X-CSRF-Token: …)    → access token, rotated cookies
```

The client **never reads `document.cookie`**, which is the property worth stating: the same two-request bootstrap works on a same-host deployment and a cross-host one, so there is no deployment-detection branch in the client and no code path that only fails in production.

### What this does not lift

`SameSite=Strict` still requires the app and the API to share a registrable domain. An SPA on `app.vercel.app` against `api.example.com` still never refreshes — the browser will not attach the refresh cookie at all, and no bootstrap endpoint changes what the browser sends. ADR-0029's "no untrusted host under the registrable domain" constraint stands unchanged too. What this ADR lifts is exactly one word in ADR-0029's constraint: cookie transport now requires same-**site**, not same-**host**.

## Consequences

- One new unauthenticated endpoint per segment, recorded as deliberately unauthenticated in the auth suites. The existing guard matrices enumerate the admin resource routes, not the auth routers, so D3.2 creates that record rather than joining one.
- The reload flow costs one extra round trip before the refresh. Same-host deployments could skip it by reading the cookie directly; the uniform protocol deliberately does not, trading one cheap request for a client with no deployment-shaped branches.
- Postman gains the request in both auth folders. The collection runs on `body` transport and is functionally unaffected — the new request documents the endpoint and asserts the envelope and the `Set-Cookie`, nothing downstream depends on it.
- Integration tests cover the triple: the cookie is set with the ADR-0029 attributes, the body echoes the same value, and the response is the standard envelope ([ADR-0012](0012-response-envelope.md)).
- `setAuthCookies` is refactored so the CSRF write exists once and is called from two places; the refresh-cookie write is untouched. **Amended 2026-08-19 (D3.2):** "once" means the attributes, which `clearAuthCookies` also needs — `res.clearCookie` only deletes a cookie whose `path`, `secure` and `sameSite` match what was set, so a drift between the writer and the clearer is a logout that leaves a live cookie behind. They are one `csrfAttributes` constant, spread by all three call sites, and deliberately not the refresh cookie's `baseAttributes`, whose `Path` differs on purpose.
- ADR-0029's §Consequences describe a constraint this ADR narrows. That record stays as written — D2 is shipped and the ADR is frozen — and it already points here by name, which is what the _Planned_ entry was for.

## Alternatives considered

- **Read `document.cookie` in the client, no endpoint.** Zero server change, and it works only same-host — that is the constraint this ADR exists to lift, and it leaves the client with a code path that silently works in one deployment shape and 403s in another.
- **`body` transport for the browser apps.** No CSRF machinery at all, and a thirty-day credential lives in JavaScript. ADR-0029 rejected it for first-party browser apps and nothing here weakens that reasoning.
- **Exempt `refresh` from the CSRF check and trust `SameSite` alone.** Then no bootstrap is needed either. Rejected by ADR-0029 §Alternatives: `SameSite` is a browser behaviour, not a server check, and a compromised sibling subdomain is same-site.
- **Return the token from an existing endpoint** — health being the obvious candidate, since it is already unauthenticated. Wrong segment (health is unversioned and population-less, ADR-0016), wrong ownership (the CSRF scheme belongs to auth), and it couples two surfaces that change for unrelated reasons. A one-route endpoint is cheaper than that coupling.
