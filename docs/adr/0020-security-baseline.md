# ADR-0020: API security baseline

- Status: superseded by [ADR-0059](0059-ci-containers-and-deployment.md) (delta: a production deployment must state its proxy hop, so `req.ip` is a decision rather than a default) and [ADR-0066](0066-infrastructure-seams.md) (delta: the limiters take a shared store when one is configured) and [ADR-0069](0069-development-rate-limit-profile.md) (delta: the committed **development** profile carries a larger `RATE_LIMIT_GLOBAL_MAX`; the schema default and every limit a deployment inherits stand) and [ADR-0073](0073-review-hardening.md) (deltas: a fifth limiter category keyed on the principal for the routes that spend an argon2 operation under a session, and a limiter key that cannot degrade to one shared bucket)
- Date: 2026-08-17

> **Superseded in part 2026-09-02 by [ADR-0059](0059-ci-containers-and-deployment.md)**, at the head of `D14.3` — the step that builds its §4–§7 and makes the delta true, not at 0059's acceptance (the `D10.5` precedent). A delta supersession per [ADR-0050](0050-adr-lifecycle-and-verification.md): this record refuses `TRUST_PROXY="true"` in production because it makes `req.ip` attacker-controlled, and 0059 §7 closes the other half — `"false"` is refused in production too, because a deployment behind a reverse proxy that simply never set the variable collapses the login limiter, the refresh limiter and the audit trail's `ip` onto the proxy's address, silently and in the permissive direction. **Everything else this record decides stands and is in force**: helmet, CORS, the body limits, the three rate limiters and their keys, the argon2 concurrency cap, `no-store`, the known-public-secret enumeration and §Residual risks. Read 0059 §7 for the production refinement and this record for the baseline.

> **Superseded in part again 2026-09-03 by [ADR-0066](0066-infrastructure-seams.md)**, accepted at the head of `D14.6` — this record's *second* successor delta, and it cashes the caveat §Consequences has carried since D1. The store behind all four limiters is built once and chosen by configuration: `rate-limit-redis` when `REDIS_URL` is set, `express-rate-limit`'s in-memory default when it is not, and a configured Redis that cannot be reached fails the limiter **closed**. **Nothing about the limits moves**: the windows, the maxima, the `IP` and `IP + email` keys, `skipSuccessfulRequests` on refresh and the per-principal impersonation key are exactly as decided here and at [ADR-0057](0057-impersonation-sessions.md) §1 — what changes is that N instances no longer mean N times each budget. This record stands and is in force for everything **neither successor** touches: helmet, CORS, the body limits, the argon2 concurrency cap, `no-store`, the known-public-secret enumeration and §Residual risks.

> **Superseded in part a third time 2026-09-05 by [ADR-0069](0069-development-rate-limit-profile.md)**, accepted at the head of `D15.8` — the step whose browser tier measured 308 requests against the global 300 and could not take the decision itself. The **committed development** profile, the root `.env.example`, carries a larger `RATE_LIMIT_GLOBAL_MAX`, because this repository's own verification is now a legitimate consumer of more than one window. **Nothing a deployment inherits moves**: the schema default is still 300, the fifteen-minute window, the login, refresh and impersonation limiters, their keys and `skipSuccessfulRequests` are exactly as decided here and, for the impersonation mint's per-principal key, at [ADR-0057](0057-impersonation-sessions.md) §1, and the production template carries no value at all. 0069 §4 restates this record's §Residual risks paragraph on the argon2 burst for the larger number rather than leaving the premise unexamined. This record stands and is in force for everything **none of its three successors** touches: helmet, CORS, the body limits, the argon2 concurrency cap, `no-store`, the known-public-secret enumeration and §Residual risks.

> **Superseded in part a fourth time 2026-09-17 by [ADR-0073](0073-review-hardening.md)**, at the head of `D20.4` — the step that builds its §1–§2 and makes both deltas true. This record's §Residual risks has named the missing category since D1, and 0073 §1 spends it: a **fifth limiter keyed on `ctx.principal.id`**, `RATE_LIMIT_PRINCIPAL_HASH_MAX` per `RATE_LIMIT_PRINCIPAL_HASH_WINDOW`, on the five authenticated routes that buy an argon2 operation — `POST /user/profile/change-password`, `DELETE /user/profile`, `DELETE /user/profile/identities/:provider` and both `POST /admin/{staff,users}/:id/password`. It closes the liveness hole this record accepted (a few authenticated clients making the hash pool shed *login* for everybody) and the guessing oracle the `D2.3` review found on the two administrative resets. 0073 §2 closes the other half of the key: where the context middleware has **no validated address**, the limiter keys on `req.socket.remoteAddress` and says so once per process, rather than keying every such caller on `""` — one bucket that would refuse the whole world at the global limit. **Nothing about the four limiters here moves**: their windows, their maxima, the `IP` and `IP + email` keys and `skipSuccessfulRequests` on refresh are exactly as decided, and the fallback address is a **key only** — it is still never written to `sessions.ip`. This record stands and is in force for everything **none of its four successors** touches: helmet, CORS, the body limits, the argon2 concurrency cap, `no-store`, the known-public-secret enumeration and the rest of §Residual risks.

## Context

A blueprint that will be copied into many projects must ship with sensible security defaults so that no project starts from an unsafe posture. This ADR collects the baseline that is not covered by auth (ADR-0018) and errors (ADR-0013).

## Decision

| Concern                   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security headers          | `helmet()` with defaults; CSP left to the frontends (API serves JSON only).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| CORS                      | `cors` with explicit allow-list from `CORS_ORIGINS`; `credentials: true` (needed for future cookie transport); methods `GET,POST,PUT,PATCH,DELETE`; expose `X-Request-Id`. No `*` in production.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Body limits               | `express.json({ limit: '1mb', strict: true })`; per-route override for uploads later.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Rate limiting             | `express-rate-limit` (memory store in dev, Redis store later): global `300 req / 15 min / IP` on `/api`, plus strict `10 / 15 min / IP+email` on `login`, `5 / 15 min` on `refresh` failures, `3 / hour` on password reset (when added). Exceeded → `429 RATE_LIMITED` envelope with `Retry-After`. `trust proxy` configured from env (`TRUST_PROXY`) so IPs are correct behind a load balancer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Password storage          | argon2id with an enforced cost floor — `createArgon2Hasher` rejects parameters below `minArgon2Params` (ADR-0018), so a misconfigured `ARGON2_*` value cannot silently weaken storage. No pepper in v1; see ADR-0018 §Consequences.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Timing                    | Dummy verify on unknown email — `hasher.dummyHash()`, warmed at composition (ADR-0018 login step 2). **Corrected 2026-08-18:** this row previously required a constant-time compare for token hashes. Refresh tokens are never compared in application code — the presented token is hashed and looked up as an indexed equality on `sessions.refresh_token_hash`, which is the intended design (a single B-tree probe). There is no secret-dependent branch to equalise: the attacker-controlled value is the token, and the compared value is a non-invertible digest. `crypto.timingSafeEqual` applies only where the API compares two secrets in process, which v1 never does.                                                                                                                                                                                    |
| Enumeration               | Login/registration/reset messages never reveal whether an email exists (register returns `201` or generic conflict message only when policy allows; default: generic).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Secrets                   | Only via env (ADR-0004); `.env` git-ignored; redaction in logs (ADR-0005).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Input                     | All input through zod (ADR-0011); `.strict()` bodies; UUID-validated params; max lengths on all strings. **Added 2026-08-18 (step 7):** the parser bounds are part of this row, not only the schemas — the query parser is `qs` with `depth: 3, arrayLimit: 20, parameterLimit: 50`, and `express.urlencoded` is mounted with `extended: false` so a form body cannot reach `qs`'s defaults (`depth: 32`, `parameterLimit: 1000`, prototype keys allowed) by a route that no schema covers.                                                                                                                                                                                                                                                                                                                                                                           |
| Proxy trust               | **Added 2026-08-18 (step 7).** `TRUST_PROXY=true` is refused when `NODE_ENV=production`. `true` makes Express take the left-most `X-Forwarded-For` entry verbatim, so `req.ip` becomes attacker-controlled — and `req.ip` is what the login rate limit above is keyed on and what the session audit trail records. A hop count, a CIDR list or `loopback` states what is actually trusted. The default is `false`.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Known-public secrets      | **Added 2026-08-18 (step 7).** Every signing key committed to the repository (`.env.example`, `apps/api/.env.test`) is enumerated in `KNOWN_PUBLIC_SECRETS`, and production startup refuses all of them (ADR-0004). Length rules cannot distinguish a public dummy from a real key; only enumeration can, and a test asserts the list covers both files. **Extended 2026-08-18 (step 8)** to the committed `SEED_SUPER_ADMIN_PASSWORD` values (`KNOWN_PUBLIC_SEED_PASSWORDS`), which are worse to leak than a signing key: the account they seed holds `super_admin`, which bypasses every staff role check (ADR-0019), and `pnpm db:setup` is the documented deploy step. Enforced twice, because the seed runner never passes through `core/config` — in the API's schema and in `packages/db/src/tooling/env.ts`, each with its own test over the committed files. |
| Output                    | Mappers strip internals (ADR-0012); no stack traces outside development (ADR-0013).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| HTTP                      | `x-powered-by` disabled; `etag` off for API responses; `Cache-Control: no-store` on every router in v1 — see the note below (amended step 10).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Dependencies              | `pnpm audit` in CI; Renovate/Dependabot; lockfile committed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Transport                 | TLS terminated at the edge; API assumes `X-Forwarded-Proto` behind proxy; HSTS from edge.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Hashing cost vs. liveness | **Added 2026-08-18.** Each argon2id hash occupies a libuv threadpool thread for ~130 ms and 64 MiB. With Node's default `UV_THREADPOOL_SIZE=4`, concurrent logins can pin the entire pool — starving DNS and filesystem work process-wide — at a request rate far below the global 300 / 15 min limit. The login rate limits above are therefore a **liveness** control as much as an anti-brute-force one. Deployments expecting concurrent logins raise `UV_THREADPOOL_SIZE` and/or cap in-flight hashes; lowering the argon2 cost to compensate is blocked by the parameter floor.                                                                                                                                                                                                                                                                                 |
| URLs in logs              | **Added 2026-08-18 (step 7).** The access line logs the **path only** — the query string is stripped. Redaction (ADR-0005) matches object keys, so a credential inside a URL string is structurally invisible to it; a future `?token=`, `?code=` or `?email=` would otherwise be written into every access line and kept for the whole retention period. Credentials belong in a body or a header, never in a URL.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Audit trail               | Sessions record ip/ua; auth events (login success/failure, refresh reuse, logout, revoke) logged at `info`/`warn` with principal id — a dedicated `audit_log` table is a later ADR.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### `no-store` is now the whole surface, not two corners of it (amended 2026-08-18, step 10)

The HTTP row above read "on auth and health endpoints", which was true when it
was written and stopped being true in step 9: `noStore` is mounted on the staff,
users and profile routers as well. The reasoning that put it on `/auth/me`
applies at least as strongly to `GET /admin/users` — one is a person's own
record, the other is the entire customer list, and a page of it held by a shared
proxy is a data breach with a cache key.

So the rule for v1 is the simpler one: **every router mounts `noStore`**, because
every route in the deliverable either issues a credential, consumes one, or
returns personal data. The Postman collection (ADR-0021) asserts it as an
invariant on every `2xx` it sees, which makes the next endpoint that is genuinely
safe to cache fail a test — deliberately. The right response to that failure is
to decide whether the exemption is real and record it here, not to delete the
assertion.

## Implementation notes (added 2026-08-18, step 8)

The rows above are now live. Four points the table did not state:

- **The login limiter runs before validation, and reads the raw body.** Its key
  is `IP + email`, and the email has to come from `req.body` because `validate`
  has not run yet. That ordering is deliberate: if the limiter ran after the
  schema, an attacker would get unlimited attempts by sending a body that fails
  validation. The value is trimmed, lower-cased and cut to 254 characters before
  it becomes a store key. This is the one place outside `core/http` that reads an
  unvalidated body, and ADR-0011's "controllers never read `req.body`" is
  unaffected — a key generator is not a controller.
- **All three limiters are built once, in `core/container.ts`.** A limiter
  _holds_ the counter, so constructing one per route mount would have given the
  same IP+email a fresh budget on `/admin/auth/login`, on `/user/auth/login` and
  on `/public/auth/register` — three times the stated limit, and three times the
  argon2 cost. Registration shares login's instance, which is what "rate-limited
  like login" (ADR-0018, amended step 4) has to mean for the limit to hold.
  Stateful components belong to the composition root (ADR-0009); this is a
  concrete reason why.
- **Rate-limit keys use the validated client address**, not `req.ip` directly.
  Under a non-`false` `TRUST_PROXY` that value comes from `X-Forwarded-For` and
  is not checked to be an address, so the context middleware runs it through
  `net.isIP` first (see §Proxy trust). Otherwise an attacker chooses an
  unbounded string that becomes a key in an in-memory store — and, on the login
  path, a value written into the `inet` column of `sessions`, where Postgres
  answers `22P02` and an unauthenticated caller gets to drive the 5xx rate.
- **The refresh limiter counts failures only** (`skipSuccessfulRequests`). An
  access token expires every 15 minutes, so a well-behaved client refreshes
  constantly and must not spend a budget meant for guessing at opaque tokens.
- **The hash cap is implemented with a bounded queue.** `AUTH_MAX_CONCURRENT_HASHES`
  (ADR-0004) admits N hashes at once; the rest queue, up to eight waiting slots
  per admitted one. Past that the request is shed with `503` and a `Retry-After`
  of one second. An unbounded queue would convert a CPU limit into a memory
  limit and answer waiters long after their client gave up; shedding is the
  honest answer to "the server is at capacity, and will not be in a moment".
  Every argon2 call on the request path — verify, the dummy verify, the rehash,
  and registration's hash — goes through it.

## Residual risks (recorded 2026-08-18, step 7)

- **Nothing budgets an argon2 operation _per principal_** (recorded
  2026-08-18, step 9). The limiters here bound login and refresh by
  guessability, keyed on IP and email. Step 9 adds
  `POST /api/v1/user/profile/change-password`, where guessing is not the issue —
  the caller already holds a session for the account — but cost is: each call
  buys up to two argon2 operations from the `AUTH_MAX_CONCURRENT_HASHES` pool
  that login shares, under nothing tighter than the global `300 / 15 min / IP`.
  A set of authenticated clients spread across IPs can therefore keep the hash
  limiter saturated, and what it sheds is _login_, for everybody. Accepted for
  now — every caller needs a valid session, the global limiter caps each one,
  and shedding is a `503` with `Retry-After` rather than a failure — but "a
  per-principal budget for expensive routes" is a missing category rather than
  a missing limiter, and the same gap will apply to password reset and to any
  future endpoint that hashes. The same argument covers deep `offset` and a
  leading-wildcard `q`, which are bounded by no ceiling at all (ADR-0014).

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
- **The hash budget is bounded per IP only by a counter, not by a rate**
  (recorded 2026-08-18, step 8). The login limiter keys on IP **and** email, so
  varying the email gives a fresh 10-request budget per key; the only aggregate
  bound for one address is the global 300 per 15 minutes, which is a counter
  over a window — all 300 may arrive in one second. At the default cap that
  fills the 32-slot queue, and the shedding that follows is **indiscriminate**:
  a staff login on `/admin/auth/login` is refused with `503` alongside the
  burst, because both draw on one process-wide limiter. Sustained, the global
  limit holds the rate to ~0.33 hashes/s against a capacity of roughly 30/s, so
  this is a burst-recovery problem (seconds) rather than a denial of service —
  which is why it is recorded rather than fixed here. The fixes, when it
  matters: a second IP-only limiter on the three hash-bearing routes, sized to
  the hash budget instead of to the request budget, and a separate concurrency
  budget for the staff segment so a public-registration burst cannot shed admin
  logins.
- **The request id is caller-choosable.** The `^[A-Za-z0-9_-]{8,64}$` filter
  closes header injection and log forgery, but a caller still _selects_ the
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
