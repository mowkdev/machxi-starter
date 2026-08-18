# ADR-0020: API security baseline

- Status: accepted
- Date: 2026-08-17

## Context

A blueprint that will be copied into many projects must ship with sensible security defaults so that no project starts from an unsafe posture. This ADR collects the baseline that is not covered by auth (ADR-0018) and errors (ADR-0013).

## Decision

| Concern | Decision |
|---|---|
| Security headers | `helmet()` with defaults; CSP left to the frontends (API serves JSON only). |
| CORS | `cors` with explicit allow-list from `CORS_ORIGINS`; `credentials: true` (needed for future cookie transport); methods `GET,POST,PUT,PATCH,DELETE`; expose `X-Request-Id`. No `*` in production. |
| Body limits | `express.json({ limit: '1mb', strict: true })`; per-route override for uploads later. |
| Rate limiting | `express-rate-limit` (memory store in dev, Redis store later): global `300 req / 15 min / IP` on `/api`, plus strict `10 / 15 min / IP+email` on `login`, `5 / 15 min` on `refresh` failures, `3 / hour` on password reset (when added). Exceeded → `429 RATE_LIMITED` envelope with `Retry-After`. `trust proxy` configured from env (`TRUST_PROXY`) so IPs are correct behind a load balancer. |
| Password storage | argon2id with an enforced cost floor — `createArgon2Hasher` rejects parameters below `minArgon2Params` (ADR-0018), so a misconfigured `ARGON2_*` value cannot silently weaken storage. No pepper in v1; see ADR-0018 §Consequences. |
| Timing | Dummy verify on unknown email — `hasher.dummyHash()`, warmed at composition (ADR-0018 login step 2). **Corrected 2026-08-18:** this row previously required a constant-time compare for token hashes. Refresh tokens are never compared in application code — the presented token is hashed and looked up as an indexed equality on `sessions.refresh_token_hash`, which is the intended design (a single B-tree probe). There is no secret-dependent branch to equalise: the attacker-controlled value is the token, and the compared value is a non-invertible digest. `crypto.timingSafeEqual` applies only where the API compares two secrets in process, which v1 never does. |
| Enumeration | Login/registration/reset messages never reveal whether an email exists (register returns `201` or generic conflict message only when policy allows; default: generic). |
| Secrets | Only via env (ADR-0004); `.env` git-ignored; redaction in logs (ADR-0005). |
| Input | All input through zod (ADR-0011); `.strict()` bodies; UUID-validated params; max lengths on all strings. **Added 2026-08-18 (step 7):** the parser bounds are part of this row, not only the schemas — the query parser is `qs` with `depth: 3, arrayLimit: 20, parameterLimit: 50`, and `express.urlencoded` is mounted with `extended: false` so a form body cannot reach `qs`'s defaults (`depth: 32`, `parameterLimit: 1000`, prototype keys allowed) by a route that no schema covers. |
| Proxy trust | **Added 2026-08-18 (step 7).** `TRUST_PROXY=true` is refused when `NODE_ENV=production`. `true` makes Express take the left-most `X-Forwarded-For` entry verbatim, so `req.ip` becomes attacker-controlled — and `req.ip` is what the login rate limit above is keyed on and what the session audit trail records. A hop count, a CIDR list or `loopback` states what is actually trusted. The default is `false`. |
| Known-public secrets | **Added 2026-08-18 (step 7).** Every signing key committed to the repository (`.env.example`, `apps/api/.env.test`) is enumerated in `KNOWN_PUBLIC_SECRETS`, and production startup refuses all of them (ADR-0004). Length rules cannot distinguish a public dummy from a real key; only enumeration can, and a test asserts the list covers both files. |
| Output | Mappers strip internals (ADR-0012); no stack traces outside development (ADR-0013). |
| HTTP | `x-powered-by` disabled; `etag` off for API responses; `Cache-Control: no-store` on auth and health endpoints. |
| Dependencies | `pnpm audit` in CI; Renovate/Dependabot; lockfile committed. |
| Transport | TLS terminated at the edge; API assumes `X-Forwarded-Proto` behind proxy; HSTS from edge. |
| Hashing cost vs. liveness | **Added 2026-08-18.** Each argon2id hash occupies a libuv threadpool thread for ~130 ms and 64 MiB. With Node's default `UV_THREADPOOL_SIZE=4`, concurrent logins can pin the entire pool — starving DNS and filesystem work process-wide — at a request rate far below the global 300 / 15 min limit. The login rate limits above are therefore a **liveness** control as much as an anti-brute-force one. Deployments expecting concurrent logins raise `UV_THREADPOOL_SIZE` and/or cap in-flight hashes; lowering the argon2 cost to compensate is blocked by the parameter floor. |
| URLs in logs | **Added 2026-08-18 (step 7).** The access line logs the **path only** — the query string is stripped. Redaction (ADR-0005) matches object keys, so a credential inside a URL string is structurally invisible to it; a future `?token=`, `?code=` or `?email=` would otherwise be written into every access line and kept for the whole retention period. Credentials belong in a body or a header, never in a URL. |
| Audit trail | Sessions record ip/ua; auth events (login success/failure, refresh reuse, logout, revoke) logged at `info`/`warn` with principal id — a dedicated `audit_log` table is a later ADR. |

## Residual risks (recorded 2026-08-18, step 7)

- **`err` is not redacted.** ADR-0005 already states that pino's error serialiser
  is outside the redact paths. `postgres.js` attaches `parameters` and `query` to
  a query error and keeps them non-enumerable only because `debug` is off by
  default, so the safety of a 5xx log line rests on a driver default. The rule
  stays upstream — never build an error message or attach an error property that
  carries a credential — and an allow-listed `err` serialiser is a candidate for
  the logging ADR's next revision.
- **Health checks are an unauthenticated, deliberately un-rate-limited query
  path.** Each `/health` or `/health/ready` request runs a real `select 1` on the
  shared pool. Today the API serves nothing else; from the auth step on, it
  competes for connections with login, which is the most expensive request the
  API has. Memoising the readiness result for ~1 s, or giving indicators their
  own connection so a saturated request pool cannot take a healthy instance out
  of rotation, belongs to ADR-0016 before the API is exposed with real traffic.
- **The request id is caller-choosable.** The `^[A-Za-z0-9_-]{8,64}$` filter
  closes header injection and log forgery, but a caller still *selects* the
  correlation id and can reuse one across thousands of requests. If abuse
  investigation ever depends on it, mint the id always and carry a validated
  inbound value as a separate field.

## Consequences

- Reasonable defaults with almost no per-project effort; each row is a single middleware or config line.
- Rate limiter memory store is per-process; multi-instance deployments must switch to the Redis store (config flag).
- Password hashing is by far the most expensive work the API does per request. It is asynchronous to JavaScript but occupies a libuv thread throughout, so capacity planning must account for `UV_THREADPOOL_SIZE` and the argon2 memory cost, not just CPU — 64 MiB per in-flight hash is the binding constraint on a small container.

## Alternatives considered

- Skipping rate limiting for v1: login brute force is the most likely attack on a fresh deployment; keep it.
- API gateway handling all of this: may exist in some deployments, but the blueprint must be safe standalone.
