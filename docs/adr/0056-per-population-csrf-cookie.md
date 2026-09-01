# ADR-0056: A CSRF cookie per population

- Status: accepted
- Date: 2026-09-01
- Supersedes: [ADR-0029](0029-browser-token-transport.md) (delta: the CSRF cookie's name is per-population; every other transport decision stands)

> Written 2026-09-01 for `D12.12` ([`docs/plan/0012-customer-app.md`](../plan/0012-customer-app.md)), a step added at the operator's post-close review out of the deliverable's own finding 6 — the D11.12 precedent: the close-out's reading produced a build step, and the row and window wait on it. **Accepted 2026-09-01**, at the head of `D12.12`, where ADR-0029 moved to `superseded by`; amendable in place while D12 is `in progress` (ADR-0025 rule 2). A delta supersession per [ADR-0050](0050-adr-lifecycle-and-verification.md): **everything ADR-0029 decided that is not named below stands** — the httpOnly refresh cookie with its per-segment `authCookiePath`, the double-submit check, the `__Host-` prefix discipline, the rotation points, and [0030](0030-csrf-bootstrap-endpoint.md)'s echoing bootstrap.

## Context

ADR-0029 shaped browser transport when exactly one SPA could hold a session against a given API host. The refresh cookies were per-segment from the start (`authCookiePath` scopes each to its own `/api/v1/{admin,user}/auth`), but the CSRF cookie is one host-wide `__Host-machxi.csrf` at `Path=/` — it must accompany every mutating request, and `__Host-` requires `Path=/` — rotated by every login and refresh and cleared by logout, logout-all and (since `D12.4`) self-deletion. D12 put a second SPA against the same host, and its close-out recorded the consequence as finding 6: **an admin refresh strands the customer app's in-memory CSRF token and vice versa**. One re-bootstrap recovers (0030's endpoint echoes rather than rotates, the reason `CSRF_TOKEN_INVALID` stopped being terminal at `D3.2`), but a second `403` inside that window is a forced sign-out caused by unrelated traffic in another tab. The deployment property only a second SPA could expose — precisely what D12 existed to find — and not amendable, because 0029 is frozen.

## Decision

**Each population gets its own CSRF cookie**: `__Host-machxi.csrf.admin` and `__Host-machxi.csrf.user`. `__Host-` constrains `Path` and `Domain`, not the name, so both keep `Path=/` and the full prefix discipline.

- **Each segment touches only its own cookie.** The admin segment's logins, refreshes, logouts and bootstraps set, rotate, echo and clear `…csrf.admin`; the user segment's — including self-deletion's `clearAuthCookies` — touch `…csrf.user`. No endpoint writes or clears the other population's cookie, which is the whole of the fix: the two apps' sessions stop sharing mutable state.
- **The double-submit check validates against the population's own cookie**, selected the same way every guard already selects a population ([0015](0015-route-segments-and-versioning.md)'s segments; [0019](0019-authorization-guards.md)).
- **Clients change nothing.** Neither SPA reads `document.cookie` ([0033](0033-browser-api-client-and-session.md)); each holds the token its own bootstrap echoed. The cookie's name is a server-side fact.
- **The legacy cookie is retired, not stranded**: the first response that would have written it clears `__Host-machxi.csrf` alongside writing the population's own, so an existing browser carries no dead cookie. The mechanics of where that clear lives are the step's.

**Amended 2026-09-01 (`D12.12`).** Three things the record left open and the build settled, written down here rather than only in the code:

- **The retirement is conditional on the request presenting the legacy cookie.** `retireLegacyCsrfCookie` in `modules/auth/auth.cookies.ts` sits inside `writeCsrfCookie` and `clearAuthCookies`, and clears `__Host-machxi.csrf` with the same attributes it was set with — but only when `readCookie` finds it. So the migration costs one extra `Set-Cookie` once per browser rather than one on every login forever. A *shadowed* legacy cookie reads as absent (`readCookie` fails closed, ADR-0029) and is left to its own `Max-Age`: it is already absent as far as this API is concerned, and clearing on an ambiguous name is not a decision to take from a header somebody else can write.
- **The guard has no default population.** `createCsrfGuard({ population, allowBodyToken })` requires it, and the auth router factory — mounted once per segment — is what supplies it, the same way `authenticate` learns its segment (ADR-0015, ADR-0019). A default would validate the admin's token on the user's endpoints the first time somebody mounted the guard without thinking, which is the sharing this record exists to end.
- **[ADR-0030](0030-csrf-bootstrap-endpoint.md) is not superseded, deliberately.** Its §What it does says the endpoint "sets `__Host-machxi.csrf` with the same attributes ADR-0029 gives it", and that sentence now names a cookie that no longer exists. It is a *restatement* of ADR-0029's decision rather than a decision of 0030's own — 0030 decided that a bootstrap endpoint exists and that it echoes rather than rotates, and both stand untouched — so the supersession of 0029 carries it, per [ADR-0050](0050-adr-lifecycle-and-verification.md)'s rule that an ADR records decisions rather than facts a reader can check against the code. Recorded here rather than left silent, because a reader arriving at 0030 first should find the judgement and not an omission: the bootstrap now writes `…csrf.admin` or `…csrf.user`, and echoes only the one its own segment owns.

## Consequences

- Two apps in one browser hold independent CSRF state; a refresh, logout or account deletion in one no longer costs the other a re-bootstrap or, in the worst window, a sign-out. D13's impersonation — staff running both apps against one host by definition — inherits a transport this cannot happen to.
- The API sends one more cookie name over its lifetime; size and semantics are otherwise unchanged.
- The integration tier gains the cross-population cases, and the browser tier gains the one spec it could not honestly write before: both apps signed in, one acting, the other unharmed.

## Alternatives considered

- **Leave it: the recovery works.** One re-bootstrap usually absorbs the collision — but "usually" is carried by timing, the terminal case is a forced sign-out from another tab's traffic, and D13 multiplies the exposure. Rejected.
- **Scope the CSRF cookie by path like the refresh cookies.** Impossible without dropping `__Host-` (the cookie must travel with every mutating request, and `__Host-` forbids a narrower path). Rejected — the prefix's guarantees are worth more than one name.
- **One shared cookie, rotation removed (echo everywhere).** Shrinks the window without closing it (logout and deletion still clear host-wide), and weakens rotation ADR-0029 chose deliberately. Rejected.
