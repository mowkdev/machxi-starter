# ADR-0018: Custom authentication — DB sessions, JWT access token, rotating refresh token

- Status: accepted
- Date: 2026-08-17

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
5. Otherwise rotate: new refresh token + hash, move old hash to `previous_…`, `rotated_at=now`, extend `refresh_token_expires_at` (sliding), issue new access token, return same body as login (minus `principal` optional).
6. Principal must still be `active`; otherwise revoke and 403.

**Logout** `POST /auth/logout` (authenticated) — revoke current session (`sid` from token) → `204`. `POST /auth/logout-all` revokes all sessions of the principal.

**Me** `GET /auth/me` (authenticated) — returns the principal resource (fresh from DB) — used by Postman tests and by clients on load.

**Admin forced logout** — `POST /admin/users/:id/sessions/revoke` (staff) revokes all sessions of a user; same for staff by super_admin. Disabling an account revokes its sessions in the same transaction.

### Password hashing

- **argon2id** (`argon2` package): memoryCost 64 MiB, timeCost 3, parallelism 1 (tunable via config); `PasswordHasher` type `{ hash(pw), verify(hash, pw), needsRehash(hash) }`, produced by `createArgon2Hasher(params)`. On successful login, if `needsRehash` → rehash and store (transparent parameter upgrades).
- Password policy v1: min 12 chars, checked by zod on register/change; breached-password check is a later addition.
- The same `PasswordHasher` implementation is used by the seed (ADR-0008); it lives in **`@repo/crypto`** (`packages/crypto`: `createArgon2Hasher(params)`, `sha256Base64url(input)`, `randomToken(bytes)`), so seeds and the API share one implementation without a seed→api dependency.

### Token transport

- v1 (API-first, Postman, mobile): access token in `Authorization: Bearer`, refresh token in the JSON body. Clients store the refresh token securely (mobile keychain; SPA memory + refresh-on-load).
- Browser apps (`web`, `admin`) will move the refresh token to an `httpOnly; Secure; SameSite=Strict` cookie scoped to `/api/v1/{user|admin}/auth/refresh` with CSRF protection — **future ADR**; the auth service is transport-agnostic (the auth service returns tokens; the controller decides body vs cookie).

### Testability

`createAuthService` takes `now: () => Date` (default `() => new Date()`) and `randomToken` as dependencies so expiry, grace windows and rotation are unit-testable without sleeping or mocking globals.

### Staff onboarding (v1)

Staff accounts are created by an admin via `POST /admin/staff` with an initial password (status `active`); the invite-by-email flow (status `invited`, set-password link) is a later feature. Users self-register via `POST /public/auth/register` when `FEATURE_USER_REGISTRATION` is on (default on) and start `active` (email verification is a later feature).

### Cleanup

- A scheduled job (later) deletes sessions with `refresh_token_expires_at < now() - 30d` or `revoked_at < now() - 30d`. Until then, `db:sessions:prune` script.

## Consequences

- Immediate revocation, rotation with reuse detection, per-device sessions, audit trail (ip/ua/last_used).
- One DB lookup per authenticated request (by primary key) — negligible for the foreseeable scale, and removable later by trusting the JWT with a short TTL + revocation cache.
- No external auth dependency; the whole flow is ~4 files and fully testable.
- Secrets management: `JWT_ACCESS_SECRET` rotation requires a key-id (`kid`) scheme — planned when moving to asymmetric keys.

## Alternatives considered

- Passport/Auth.js/Lucia/Better-Auth: excluded by requirement; also add opinions on schema and transport.
- Opaque access token (session id) instead of JWT: simpler, but every service-to-service or edge check needs the DB; JWT keeps the option of stateless verification later.
- Long-lived JWT without sessions: no revocation — rejected.
- Refresh token stored plaintext: leaks on DB read — hashed only.
- bcrypt: fine but argon2id is the current recommendation and handles long passwords.
