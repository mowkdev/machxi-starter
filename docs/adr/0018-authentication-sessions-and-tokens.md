# ADR-0018: Custom authentication — DB sessions, JWT access token, rotating refresh token

- Status: superseded by [ADR-0057](0057-impersonation-sessions.md) and [ADR-0064](0064-brand-seams.md) (deltas: impersonated sessions — a second mint path beside login, `sessions.impersonated_by_staff_id`, and rotation without the sliding extension; and the `aud` claim's leading word comes from `APP_ID`)
- Date: 2026-08-17

> **Superseded in part 2026-09-01 by [ADR-0057](0057-impersonation-sessions.md)**, accepted at the head of `D13.1`. A delta supersession per [ADR-0050](0050-adr-lifecycle-and-verification.md): 0057 adds a **second way to mint a `user` session** (an admin-guarded mint, a single-use handoff token, and an exchange endpoint), an **actor column** on `sessions` recording the staff id that minted it, and — for those sessions only — a **fixed end that rotation does not extend**, with the access token's `exp` capped at it. **Everything this record decides about ordinary sessions stands and is in force**: the token model and claims, the 30-day sliding refresh, rotation and reuse detection with its grace window, the session table and its revocation reasons, `authenticate`'s hot path, the transport delegation, and the cleanup sweep — which grows the handoff rows' deletion rather than changing. Read 0057 for impersonation and this record for everything else.
>
> **Superseded in part a second time 2026-09-03, at the head of `D14.7`.** [ADR-0064](0064-brand-seams.md) makes the audience `` `${appId}-${population}` ``, from the API's `APP_ID`, which defaults to `machxi` — so `machxi-staff` and `machxi-user` are what this repository still signs and verifies. **Audience verification itself is untouched**, and so is its purpose: it remains the second line of defence behind `authenticate(population)`, checked inside `jose` before any of our code reads a claim. The brand in the string is a fork-day value; the claim, the check and the cross-population guarantee are this record's and stand. `JWT_ISSUER` is unchanged and deliberately separate — fusing an issuer with a cookie name would make a key rotation a sign-out (0064 §Alternatives).

## Context

Authentication must be implemented in-house (no Passport/Auth.js/Lucia/etc.), with server-side sessions in the database, an access token and a refresh token, separately for staff and users (ADR-0017), and must be testable from Postman. It must be revocable (logout, admin-forced), resistant to token theft (rotation, reuse detection), and cheap on the hot path.

## Decision

### Model

- **Access token**: JWT (HS256 for v1, `JWT_ACCESS_SECRET` ≥ 32 bytes; asymmetric RS256/EdDSA can be introduced later without changing the flow), short-lived (`JWT_ACCESS_TTL=15m`), signed/verified with **`jose`** (ESM-native, zero deps, supports the future key-rotation path). Claims:

  ```json
  { "sub": "<principal id>", "pop": "staff" | "user", "sid": "<session id>", "roles": ["admin"], "iat": …, "exp": …, "iss": "machxi-api", "aud": "machxi-staff" | "machxi-user", "jti": "<uuid>" }
  ```

  `aud` differs per population so a token cannot be replayed on the other segment even if the middleware were misconfigured.

- **Refresh token**: opaque, 32 random bytes base64url (`crypto.randomBytes`), long-lived (`REFRESH_TOKEN_TTL=30d`, sliding). Only its **SHA-256 hash** is stored. Sent to the client once; on use it is **rotated** (new refresh token, old one marked used).

- **Session** row (one per login on a device):

  ```
  sessions
  --------
  id uuid pk
  principal_type enum('staff','user')
  principal_id uuid
  refresh_token_hash text unique
  refresh_token_expires_at timestamptz
  previous_refresh_token_hash text null       -- for reuse detection grace
  rotated_at timestamptz null
  ip inet null, user_agent text null
  last_used_at timestamptz
  revoked_at timestamptz null, revoked_reason text null
  created_at, updated_at
  index (principal_type, principal_id), unique index (refresh_token_hash), index (previous_refresh_token_hash)
  ```

### Flows (per population; paths under `/api/v1/{user|admin}/auth`, ADR-0015)

**Login** `POST /auth/login` `{ email, password }`

1. Rate-limited per IP + email (ADR-0020).
2. Find principal by email in the population's table; **always** run the password verifier (against a dummy hash if not found) to equalise timing.
3. Reject if not found / wrong password → `AUTH_INVALID_CREDENTIALS` (401, same message either way). Reject if `status != active` → `AUTH_ACCOUNT_DISABLED` (403).
4. Create session (refresh hash, ip, ua), issue access JWT with `sid`, return:
   ```json
   { "accessToken": "…", "accessTokenExpiresAt": "…", "refreshToken": "…", "refreshTokenExpiresAt": "…", "tokenType": "Bearer", "principal": { "id", "email", "roles", "kind" } }
   ```
5. Update `last_login_at`.

**Authenticated request** — `Authorization: Bearer <access>`; middleware verifies JWT (signature, `exp`, `iss`, `aud` matches segment population), then **loads the session by `sid`** and checks `revoked_at is null`. Yes, this is one indexed PK lookup per request — accepted deliberately so revocation is immediate (logout / admin disable). Principal roles are taken from the JWT claims for v1 (fresh at most 15 min); a `roles_version`/re-fetch can be added if role changes must apply instantly.

**Refresh** `POST /auth/refresh` `{ refreshToken }`

1. Hash, look up session by hash (also match `previous_refresh_token_hash` inside a short grace window ≤ 30 s to tolerate concurrent refreshes from the same client).
2. Not found → `AUTH_INVALID_REFRESH_TOKEN` (401).
3. Found but `revoked_at` set or expired → 401.
4. Found via **previous** hash outside grace → **reuse detected**: revoke the session (`revoked_reason='refresh_reuse'`), log at `warn`, return `AUTH_REFRESH_REUSED` (401). (Optionally revoke all sessions of the principal — configurable, default off.)
5. Otherwise rotate: new refresh token + hash, move old hash to `previous_…`, `rotated_at=now`, extend `refresh_token_expires_at` (sliding), issue new access token, return the same body as login — **`principal` included** (amended 2026-08-18, step 4: the contract type `AuthResource` makes it required). Step 6 below already loads the principal to re-check `active`, so the field is free, and it saves a client restoring a session from a stored refresh token the extra `me` call. A required field also cannot be dropped later without a version bump, which is the direction ADR-0015 wants.
6. Principal must still be `active`; otherwise revoke and 403.

**Logout** `POST /auth/logout` (authenticated) — revoke current session (`sid` from token) → `204`. `POST /auth/logout-all` revokes all sessions of the principal.

**Me** `GET /auth/me` (authenticated) — returns the principal resource (fresh from DB) — used by Postman tests and by clients on load.

**Admin forced logout** — `POST /admin/users/:id/sessions/revoke` (staff) revokes all sessions of a user; same for staff by super_admin. Disabling an account revokes its sessions in the same transaction.

**Amended 2026-08-18 (implementation step 8).** Implementing the flows above
settled six points the decision left open. The behaviour is now:

- **A refresh inside the grace window rotates again.** Step 1 says a hit on
  `previous_refresh_token_hash` within the window is tolerated, but not what to
  answer with. The plaintext of the _current_ token is not stored — only its
  digest — so it cannot be re-sent; the session therefore rotates from its
  current hash and the caller gets a fresh pair. The pair issued by the first
  call keeps working for another window as the new previous hash, which is what
  makes two concurrent refreshes both succeed instead of one logging the other
  out.
- **Rotation is guarded on the hash it replaces.** The `UPDATE` matches on
  `id AND refresh_token_hash = <the hash we read> AND revoked_at IS NULL`. Two
  refreshes racing on one session would otherwise both succeed, and the loser
  would hand its client a token no row references. Zero rows updated is answered
  as `AUTH_INVALID_REFRESH_TOKEN`.
- **A revoked session and an expired one answer differently.** Step 3 groups
  them as "401". They are `AUTH_SESSION_REVOKED` and
  `AUTH_INVALID_REFRESH_TOKEN` respectively, matching the code table in
  `@repo/contracts`. The population check runs _first_, so a token belonging to
  the other segment is always `AUTH_INVALID_REFRESH_TOKEN` — indistinguishable
  from an unknown token, per ADR-0019 §1.
- **`last_used_at` is written on refresh, not on every authenticated request.**
  §Authenticated request describes a primary-key read; touching the row per
  request would make it a write per request, on the hottest path the API has.
  The audit trail keeps refresh granularity, which is what a per-device session
  record is actually asked about.
- **`GET /auth/me` revokes when the principal is gone or inactive.** Refusing
  alone would leave the refresh token alive to mint a new access token minutes
  later. Same for refresh (step 6): an inactive principal has _all_ its sessions
  revoked, not just the one presented.
- **Population and revocation are checked before the reuse branch.** That
  branch has a side effect — it revokes — so ordering is not cosmetic. A
  rotated-out token of the _other_ population must answer
  `AUTH_INVALID_REFRESH_TOKEN` without touching that session (ADR-0019 §1), and
  a token whose session was already revoked is the ordinary "a stale tab
  retried after logout" case, answered `AUTH_SESSION_REVOKED`. Reporting that
  as reuse would fire the `warn` that ADR-0020 §Audit trail reserves for token
  theft on the commonest client bug there is, which is how such a signal stops
  being worth alerting on.
- **`db:sessions:prune` exists** (see §Cleanup), in `@repo/db`, deleting
  sessions whose refresh token expired or which were revoked more than
  `RETENTION_DAYS` (30) ago. It is deliberately not refused in production —
  pruning is what a production database needs, and it can only delete rows that
  are already unusable.

### Password hashing

- **argon2id** (`argon2` package): memoryCost 64 MiB, timeCost 3, parallelism 1 (tunable via config); `PasswordHasher` type `{ hash(pw), verify(hash, pw), needsRehash(hash), dummyHash() }`, produced by `createArgon2Hasher(params)`. On successful login, if `needsRehash` → rehash and store (transparent parameter upgrades).
- Password policy v1: min 12 chars, checked by zod on register/change; breached-password check is a later addition.
- The same `PasswordHasher` implementation is used by the seed (ADR-0008); it lives in **`@repo/crypto`** (`packages/crypto`: `createArgon2Hasher(params)`, `sha256Base64url(input)`, `randomToken(bytes)`), so seeds and the API share one implementation without a seed→api dependency.

**Amended 2026-08-18 (implementation step 3).** Building the package surfaced four points the decision above did not settle. The behaviour is now:

- `dummyHash()` belongs to the hasher, not to the auth service. The login flow's equal-timing rule (**Login**, step 2 above) only holds if the dummy carries the _same_ cost parameters as a real verify, and only the hasher knows them. It is memoised, and a rejection is deliberately **not** memoised — caching a failed promise would make every later unknown-email login fail instantly, a louder oracle than the one it closes. **The container must warm it (`await hasher.dummyHash()`) before the server binds**, or the first unknown-email login pays hash + verify while a known-email login pays verify alone.
- `verify` returns `false` for a stored value that is not a readable argon2 digest, so a corrupt row fails the login rather than 500-ing it. Every other failure (native binding unavailable, out of memory under load) is **rethrown** — swallowing those would silently degrade the whole deployment to "wrong password" while ADR-0020's login rate limiter locked real users out.
- `needsRehash` also returns `true` for a digest that is not argon2id or is unreadable. `argon2.needsRehash` compares only `v`/`m`/`t`/`p`, and `argon2.verify` accepts argon2i and argon2d digests — so without the explicit algorithm check an imported non-argon2id hash would verify happily and never be upgraded.
- `createArgon2Hasher` **rejects parameters below a floor** (`minArgon2Params`: 19456 KiB / t=2 / p=1, the OWASP argon2id second-choice profile), because libargon2 itself only rejects `m < 8*p` and `t < 1`. The check lives in the package rather than only in the ADR-0004 config schema because the seeders build a hasher directly and never pass through `core/config`. Tests opt out with `allowWeakParams: true`; no production call site sets it.

- **Known residual (accepted, not fixed).** The dummy hash always uses the _current_ parameters, while an account whose password has not been rehashed yet verifies at the _old_ cost. Between an `ARGON2_*` increase and a given account's next successful login, "account with a legacy cheaper hash" stays timing-distinguishable from "no such account". This is inherent to transparent parameter upgrades — the alternative is rehashing every row offline, which requires the plaintext. Accepted.

The package therefore exports `createArgon2Hasher`, `defaultArgon2Params` (the single source for the ADR-0004 `ARGON2_*` defaults — `core/config` should reference it rather than re-typing the literals), `minArgon2Params`, `sha256Base64url`, `randomToken` and its `minTokenBytes`/`maxTokenBytes` bounds. `hashLength` is pinned at 32; the 16-byte salt is not configurable in argon2 0.45 and is covered by a test instead.

### Token transport

- v1 (API-first, Postman, mobile): access token in `Authorization: Bearer`, refresh token in the JSON body. Clients store the refresh token securely (mobile keychain; SPA memory + refresh-on-load).
- Browser apps (`web`, `admin`) will move the refresh token to an `httpOnly; Secure; SameSite=Strict` cookie scoped to `/api/v1/{user|admin}/auth/refresh` with CSRF protection — **future ADR**; the auth service is transport-agnostic (the auth service returns tokens; the controller decides body vs cookie).

### Testability

`createAuthService` takes `now: () => Date` (default `() => new Date()`) and `randomToken` as dependencies so expiry, grace windows and rotation are unit-testable without sleeping or mocking globals.

### Staff onboarding (v1)

Staff accounts are created by an admin via `POST /admin/staff` with an initial password (status `active`); the invite-by-email flow (status `invited`, set-password link) is a later feature. Users self-register via `POST /public/auth/register` when `FEATURE_USER_REGISTRATION` is on (default on) and start `active` (email verification is a later feature).

**Amended 2026-08-18 (step 4).** Registration returns `201` with the same `AuthResource` as login, so the new account is signed in without a second round trip. Two consequences follow and are accepted: the endpoint **creates a session row**, so it is rate-limited like login and shares its argon2 threadpool cost (ADR-0020 §Rate limiting, §Hashing cost vs. liveness); and a duplicate email is answered with a plain `409 CONFLICT` whose message does not confirm the address — **never** `USER_EMAIL_TAKEN`, which is reserved for the authenticated `POST /admin/users`. That is ADR-0020 §Enumeration's stated default ("generic"), and it is the only mitigation available while there is no email verification to hide behind.

### Cleanup

- A scheduled job (later) deletes sessions with `refresh_token_expires_at < now() - 30d` or `revoked_at < now() - 30d`. Until then, `db:sessions:prune` script.

## Consequences

- Immediate revocation, rotation with reuse detection, per-device sessions, audit trail (ip/ua/last_used).
- One DB lookup per authenticated request (by primary key) — negligible for the foreseeable scale, and removable later by trusting the JWT with a short TTL + revocation cache.
- No external auth dependency; the whole flow is ~4 files and fully testable.
- Secrets management: `JWT_ACCESS_SECRET` rotation requires a key-id (`kid`) scheme — planned when moving to asymmetric keys.
- **Reuse detection is probabilistic, not deterministic** (recorded 2026-08-18,
  step 8). A session remembers exactly **one** previous hash, and a refresh
  served through the grace window rotates from the _current_ hash and resets
  `rotated_at` — so the token that was actually presented is dropped from the
  row, and the window renews. A stolen token replayed inside the window
  therefore becomes the live credential, and an attacker who keeps refreshing
  inside it keeps renewing. Detection still fires the moment the legitimate
  holder refreshes, because that request will be outside the window, so the
  exposure is bounded rather than open-ended. Making it exact needs either a
  generation counter or a short ring of previous hashes; both change the schema
  and the flow, so they belong in a superseding ADR rather than in a patch.
- **No pepper in v1** (recorded 2026-08-18). `argon2` supports a `secret` (keyed hashing); using it would make a database-only compromise useless without the application key, which is a real gain over cost parameters alone. It is deferred rather than dismissed because it needs exactly the key-id/rotation machinery the `kid` scheme above needs, and because rotating a pepper invalidates every stored hash — the only migration path is rehash-on-next-login with both keys held during the overlap. Both belong in the same future **secret management and key rotation** ADR; `createArgon2Hasher` would gain a `secret` parameter at that point, and the `PasswordHasher` port already isolates every call site from the change.

## Alternatives considered

- Passport/Auth.js/Lucia/Better-Auth: excluded by requirement; also add opinions on schema and transport.
- Opaque access token (session id) instead of JWT: simpler, but every service-to-service or edge check needs the DB; JWT keeps the option of stateless verification later.
- Long-lived JWT without sessions: no revocation — rejected.
- Refresh token stored plaintext: leaks on DB read — hashed only.
- bcrypt: fine but argon2id is the current recommendation and handles long passwords.
