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
| Password storage | argon2id (ADR-0018). |
| Timing | Constant-time compare for token hashes (`crypto.timingSafeEqual`); dummy verify on unknown email. |
| Enumeration | Login/registration/reset messages never reveal whether an email exists (register returns `201` or generic conflict message only when policy allows; default: generic). |
| Secrets | Only via env (ADR-0004); `.env` git-ignored; redaction in logs (ADR-0005). |
| Input | All input through zod (ADR-0011); `.strict()` bodies; UUID-validated params; max lengths on all strings. |
| Output | Mappers strip internals (ADR-0012); no stack traces outside development (ADR-0013). |
| HTTP | `x-powered-by` disabled; `etag` off for API responses; `Cache-Control: no-store` on auth and health endpoints. |
| Dependencies | `pnpm audit` in CI; Renovate/Dependabot; lockfile committed. |
| Transport | TLS terminated at the edge; API assumes `X-Forwarded-Proto` behind proxy; HSTS from edge. |
| Audit trail | Sessions record ip/ua; auth events (login success/failure, refresh reuse, logout, revoke) logged at `info`/`warn` with principal id — a dedicated `audit_log` table is a later ADR. |

## Consequences

- Reasonable defaults with almost no per-project effort; each row is a single middleware or config line.
- Rate limiter memory store is per-process; multi-instance deployments must switch to the Redis store (config flag).

## Alternatives considered

- Skipping rate limiting for v1: login brute force is the most likely attack on a fresh deployment; keep it.
- API gateway handling all of this: may exist in some deployments, but the blueprint must be safe standalone.
