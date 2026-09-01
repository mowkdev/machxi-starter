# ADR-0057: Impersonation sessions — the mint, the handoff, the exclusions

- Status: proposed
- Date: 2026-09-01
- Supersedes: [ADR-0018](0018-authentication-sessions-and-tokens.md) (delta: impersonated sessions — a second mint path beside login, an actor column on `sessions`, and rotation without the sliding extension; every decision about ordinary sessions stands); [ADR-0052](0052-grid-and-admin-followups.md) (delta: the documented gate grows a fifth link, `pnpm format:check` — D12's close-out loose end 2, taken at scoping as that record prescribed)

> Written 2026-09-01 by `/scope` for D13 ([`docs/plan/0013-impersonation.md`](../plan/0013-impersonation.md)) — writing is not opening, opening is not accepting. `proposed` at writing; **accepted at the head of `D13.1`**, where ADR-0018 and ADR-0052 move to `superseded by`; amendable in place while D13 is `in progress` (ADR-0025 rule 2). A delta supersession per [ADR-0050](0050-adr-lifecycle-and-verification.md): everything either parent decided that is not named above stands. The scope file's design sketch (2026-08-20) is this record's input; where this record decides differently it says so. Its sibling is [ADR-0058](0058-append-only-audit-log.md) (the audit mechanism this record writes into), accepted at `D13.2`'s head.

## Context

Staff must be able to open the customer app **as a chosen customer**: see what they see, fix what they cannot describe, and leave a trail. The pieces have been waiting for it by name — the shell's `banner` slot and the `Banner` composition's `warning` variant (ADR-0048, `banner.tsx`), ADR-0055's rejection of a mode-of-admin partly *because* impersonation needs two apps, and ADR-0056, whose per-population CSRF cookies mean two sessions in one browser no longer share mutable transport state. What does not exist: any way to mint a `user` session other than that user's password, any attribution of a session to a second identity, and (per [ADR-0058](0058-append-only-audit-log.md)'s context) any audit mechanism. The hard problem is the handoff: sessions live in httpOnly cookies on the API host, and minting must neither touch the staff session that asked nor silently destroy a real customer session server-side.

Four decisions were taken by the operator at scoping (2026-09-01) and are carried here: audit goes to an **append-only table** (0058), not logs alone; a pre-existing customer session in the minting browser is **overwritten in the cookie jar and left alive in the database**; **settings writes are allowed** under impersonation, audited; and the standing assumption — full access minus credential operations — is confirmed.

## Decision

### 1. The mint — `POST /api/v1/admin/users/:id/impersonate`

Staff-guarded on the admin segment, `authorize("admin")` — a `manager` is neither offered ([ADR-0042](0042-client-side-authorization.md)'s table) nor allowed, and `super_admin` passes by ADR-0019's one line. The target must be an active, non-deleted user; anything else is refused before a token exists. The endpoint gets **its own rate limiter keyed on the staff principal's id** (`RATE_LIMIT_IMPERSONATION_MAX`, default 10 per window): ADR-0020's login limiter keys on `IP + email` read from the body, which a mint does not carry, and an authenticated high-value operation wants a per-actor budget, not a per-IP one.

The response carries a **handoff token, not a session**: no `Set-Cookie` of any kind, which is what leaves the staff session untouched — the admin segment's cookies are never written by this flow at all (ADR-0056's "each segment touches only its own", inherited rather than re-decided).

### 2. The handoff token

Opaque (`randomToken(32)`), stored **only as its SHA-256 hash** in a new `impersonation_handoffs` table (token hash unique, staff id, target user id, expiry, `consumed_at`, mint ip/ua), short-lived (`IMPERSONATION_HANDOFF_TTL`, default 60s), and **strictly single-use**: the exchange consumes it atomically (`update … where consumed_at is null` returning), and a replay — inside any window — answers `401` with nothing minted. This is why the handoff is not simply the session's refresh token delivered by URL: ADR-0018's rotation grace deliberately tolerates a replayed refresh for 30 seconds, and a credential that travels through a URL must not have a grace window. The admin app delivers it to the customer app in the **URL fragment** (`/impersonate#token=…`), which no server log or `Referer` sees.

### 3. The exchange — `POST /api/v1/user/auth/impersonate`

On the user segment's auth router, unauthenticated — the token is the credential. It consumes the handoff, creates the session (§4), sets the user-population cookies **exactly as login does** — the path-scoped refresh cookie and `__Host-machxi.csrf.user` — and returns the login-shaped `AuthResource`. If the browser already held a real customer session, its cookies are overwritten and **its session row is not touched**: the customer's other devices are unaffected, and this browser signs back in normally afterwards (the operator's call; refusing would break every staff member who is also a customer, and revoking would end a session that was not the actor's to end).

### 4. The session

A `user`-population session with two deltas on ADR-0018, both visible in the row:

- **`sessions.impersonated_by_staff_id`** (uuid, nullable, **deliberately no foreign key**): staff are hard-deleted (ADR-0028), and attribution must survive its actor's deletion — the same reasoning that left `principal_id` FK-less.
- **A fixed end.** `refresh_token_expires_at` is set to mint + `IMPERSONATION_SESSION_TTL` (default 30m) and **rotation does not extend it** — the one change to ADR-0018's refresh flow, applied only when the actor column is set. Refresh otherwise works normally (rotation, reuse detection, the grace window), which is what lets a reload survive: the app boots off the cookie as ever. When the end passes, refresh answers `401` and the app signs out. An impersonation that needs more time is **re-minted**, on the trail, never extended. The access token's `exp` is capped at the session's end, so no JWT outlives it.

The JWT gains an actor claim (RFC 8693's `act` shape, carrying the staff id) so `authenticate` can put `impersonatedBy` on `ctx.principal` without a second lookup; the session row remains the source of truth at refresh. The wire principal — `UserPrincipalResource` in `@repo/contracts` — gains an optional **`impersonatedBy: { id, email }`**, resolved from the staff table at the auth endpoints only (exchange, refresh, me), never per request. The banner renders from this field and from nothing else: it survives reload because the session does, and it is unforgeable because the API set it.

### 5. The exclusions

An impersonated session is refused the operations that would let an impersonator take the account over, with **one error code for the class, `AUTH_IMPERSONATION_REFUSED` (403)** — the scope sketch said "their own error codes" per operation, and this record decides one: the client already knows which dialog the refusal came from, and a code per operation is enum growth with no reader. The list:

- `POST /user/profile/change-password`
- `DELETE /user/profile` (self-deletion, ADR-0055 §4)
- `POST /user/auth/logout-all` (revoking the customer's real sessions)

Enforced by a **`refuseImpersonated` middleware named in the router files**, ADR-0019's declarative style — never a hidden button. Everything else the customer can do, the impersonator can do, audited: profile `PATCH`, settings writes (theme, locale, density, grid preferences — the operator's call: reproducing an issue sometimes needs them, and every write lands with both identities). `POST /user/auth/logout` is deliberately **not** excluded — it is the exit.

### 6. Exit, expiry, attribution

The banner's exit control calls the ordinary logout; the service sees the actor column and revokes with reason **`impersonation_ended`**, writing the audit event. Expiry needs no event of its own: the mint event records the session's end, so an un-exited trail is complete by construction. Every request on an impersonated session carries both identities in the logs — `authenticate`'s `logger.child` and the completion line's `principalProps` gain `impersonatedBy` — and the audit table (0058) receives the lifecycle events (minted, exchanged, ended) plus one row per **mutating** request served under impersonation. Reads are logged, not audited.

### 7. The two clients

- **`apps/admin`**: an Impersonate row action on the users grid; `RESOURCE_POLICY.users` gains `impersonate: ["admin"]` (role-only category — exactly what ADR-0042 permits `can()` to answer), the fixture test grows the row, and the action opens `VITE_CUSTOMER_APP_URL` (new env var, ADR-0004 discipline) at `/impersonate#token=…`.
- **`apps/customer`**: an `/impersonate` route redeems the fragment through **`redeemHandoff(token)`, a new `@repo/api-client` function beside `login`** — the store keeps its single writer set, per that package's own rule — then navigates home. `ImpersonationBanner` is a thin per-app component reading `principal.impersonatedBy` into the shell's `banner` slot (`variant="warning"`, `dismissible={false}` — the defaults `banner.tsx` shipped for this by name); exit calls logout and lands on a signed-out screen. Refusals render as catalogue copy in `en` and `lv` like any other code.

### 8. The gate — the ADR-0052 delta

The documented gate grows its fifth link: `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check`. Every deliverable since D3 has relied on a once-per-close manual `format:check` sweep for a check a machine can run each step; every document that states the gate changes in the accepting step's sweep, the D10.5 mechanics.

## Consequences

- This is the highest-risk security surface in the ledger, and the plan makes `security-reviewer` mandatory on **every step**, not just the PR gate.
- A new error code meets D12 finding 3: an already-shipped bundle parses `code` as a closed enum and would render `AUTH_IMPERSONATION_REFUSED` as "check your connection". The degradation fix therefore lands at `D13.1`, **before** the code exists — the contracts comment (`errors.ts`) already says unknown codes must degrade to the generic fallback; the envelope schema is what disagrees.
- Two new config keys and a limiter key enter ADR-0004's schema, `.env.example` and `turbo.json`; the e2e suites' `assertApiWindowClear` budget tightens by the new requests.
- The customer app inherits nothing new in transport: ADR-0056 already made two sessions in one browser safe, which this feature exercises by definition.

## Alternatives considered

- **Read-only impersonation.** Cannot fix anything, which is what support opens the app for; rejected at the 2026-08-20 scoping and confirmed 2026-09-01.
- **Unrestricted impersonation.** A quiet account takeover path; the exclusion list is the difference between a support tool and a liability. Rejected.
- **The refresh token as the handoff.** One mint path and replay-kills-the-session for free — but ADR-0018's grace window would make the URL-borne credential replayable for 30 seconds, and tightening the grace for one session class complicates the hottest auth path. Rejected for a dedicated single-use artifact.
- **A separate cookie namespace for impersonated sessions**, preserving a real customer session's cookies. Every user-segment guard and the CSRF check would need two names and a precedence rule — permanent complexity in the security path to avoid one sign-in after an event that support performs rarely. Rejected.
- **Mint and set cookies in one admin-segment response.** Would have the admin segment writing user-population cookies, precisely the sharing ADR-0056 exists to end. Rejected; the handoff is the design.
- **An error code per excluded operation.** No reader benefits: the client renders refusals in the context that produced them. Rejected.
