# ADR-0056: A CSRF cookie per population

- Status: proposed
- Date: 2026-09-01
- Supersedes: [ADR-0029](0029-browser-token-transport.md) (delta: the CSRF cookie's name is per-population; every other transport decision stands)

> Written 2026-09-01 for `D12.12` ([`docs/plan/0012-customer-app.md`](../plan/0012-customer-app.md)), a step added at the operator's post-close review out of the deliverable's own finding 6 — the D11.12 precedent: the close-out's reading produced a build step, and the row and window wait on it. Accepted at the head of `D12.12`, where ADR-0029 moves to `superseded by`; amendable in place while D12 is `in progress` (ADR-0025 rule 2). A delta supersession per [ADR-0050](0050-adr-lifecycle-and-verification.md): **everything ADR-0029 decided that is not named below stands** — the httpOnly refresh cookie with its per-segment `authCookiePath`, the double-submit check, the `__Host-` prefix discipline, the rotation points, and [0030](0030-csrf-bootstrap-endpoint.md)'s echoing bootstrap.

## Context

ADR-0029 shaped browser transport when exactly one SPA could hold a session against a given API host. The refresh cookies were per-segment from the start (`authCookiePath` scopes each to its own `/api/v1/{admin,user}/auth`), but the CSRF cookie is one host-wide `__Host-machxi.csrf` at `Path=/` — it must accompany every mutating request, and `__Host-` requires `Path=/` — rotated by every login and refresh and cleared by logout, logout-all and (since `D12.4`) self-deletion. D12 put a second SPA against the same host, and its close-out recorded the consequence as finding 6: **an admin refresh strands the customer app's in-memory CSRF token and vice versa**. One re-bootstrap recovers (0030's endpoint echoes rather than rotates, the reason `CSRF_TOKEN_INVALID` stopped being terminal at `D3.2`), but a second `403` inside that window is a forced sign-out caused by unrelated traffic in another tab. The deployment property only a second SPA could expose — precisely what D12 existed to find — and not amendable, because 0029 is frozen.

## Decision

**Each population gets its own CSRF cookie**: `__Host-machxi.csrf.admin` and `__Host-machxi.csrf.user`. `__Host-` constrains `Path` and `Domain`, not the name, so both keep `Path=/` and the full prefix discipline.

- **Each segment touches only its own cookie.** The admin segment's logins, refreshes, logouts and bootstraps set, rotate, echo and clear `…csrf.admin`; the user segment's — including self-deletion's `clearAuthCookies` — touch `…csrf.user`. No endpoint writes or clears the other population's cookie, which is the whole of the fix: the two apps' sessions stop sharing mutable state.
- **The double-submit check validates against the population's own cookie**, selected the same way every guard already selects a population ([0015](0015-route-segments-and-versioning.md)'s segments; [0019](0019-authorization-guards.md)).
- **Clients change nothing.** Neither SPA reads `document.cookie` ([0033](0033-browser-api-client-and-session.md)); each holds the token its own bootstrap echoed. The cookie's name is a server-side fact.
- **The legacy cookie is retired, not stranded**: the first response that would have written it clears `__Host-machxi.csrf` alongside writing the population's own, so an existing browser carries no dead cookie. The mechanics of where that clear lives are the step's.

## Consequences

- Two apps in one browser hold independent CSRF state; a refresh, logout or account deletion in one no longer costs the other a re-bootstrap or, in the worst window, a sign-out. D13's impersonation — staff running both apps against one host by definition — inherits a transport this cannot happen to.
- The API sends one more cookie name over its lifetime; size and semantics are otherwise unchanged.
- The integration tier gains the cross-population cases, and the browser tier gains the one spec it could not honestly write before: both apps signed in, one acting, the other unharmed.

## Alternatives considered

- **Leave it: the recovery works.** One re-bootstrap usually absorbs the collision — but "usually" is carried by timing, the terminal case is a forced sign-out from another tab's traffic, and D13 multiplies the exposure. Rejected.
- **Scope the CSRF cookie by path like the refresh cookies.** Impossible without dropping `__Host-` (the cookie must travel with every mutating request, and `__Host-` forbids a narrower path). Rejected — the prefix's guarantees are worth more than one name.
- **One shared cookie, rotation removed (echo everywhere).** Shrinks the window without closing it (logout and deletion still clear host-wide), and weakens rotation ADR-0029 chose deliberately. Rejected.
