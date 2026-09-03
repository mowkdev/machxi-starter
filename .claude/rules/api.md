---
paths:
  - "apps/api/**"
  - "packages/contracts/**"
  - "packages/db/**"
  - "packages/crypto/**"
  - "packages/logger/**"
---

# API and data non-negotiables (from the ADRs)

Loaded when you touch the API or its packages. `/api-conventions` is the fuller reference; the ADRs are the source of truth.

- **Functional style, no OOP** (ADR-0009): no `class`, no `this`, no decorators, no DI container. Every layer is `create<Module><Layer>(deps)` returning an `as const` object; types via `ReturnType`. Wrap third-party constructors in `create*` functions.
- **Layers** (ADR-0009): `*.routes.ts` → `*.controller.ts` → `*.service.ts` → `*.repository.ts`. Services never import Express or SQL; repositories hold all Drizzle queries; controllers only parse `req.valid`, call the service with `req.ctx` first, and respond via `respond.*`.
- **Envelope** (ADR-0012): controllers use only `respond.ok / created / list / noContent`; never `res.json` outside `apps/api/src/core/http`.
- **Errors** (ADR-0013): one branded `AppError`; throw via factories (`notFound()`, `forbidden()`, module `*.errors.ts`); check with `isAppError(e)` + `e.code`; never `instanceof`, never new error classes. The API's `message` is developer-facing English and is never rendered by a client.
- **Config** (ADR-0004): `process.env` only in `core/config`, `packages/db/src/tooling/env.ts`, `scripts/postman.mjs` and the `apps/api/test/` harness. Every new variable → zod schema + `.env.example` (+ `turbo.json` `env` if a task reads it, ADR-0026).
- **Context** (ADR-0010): services take `ctx: RequestContext` as first parameter; `getContext()` is for infrastructure only.
- **Validation** (ADR-0011): zod schemas live in `@repo/contracts` and are re-exported by `<module>.schemas.ts`; controllers read `req.valid.{params,query,body}` only; bodies are `.strict()`.
- **Auth** (ADR-0017–0019): two populations (`staff`, `user`), separate tables, separate segments `/api/v1/{public,user,admin}`; `authenticate()` at router level, `authorize()` at mount; `super_admin` bypasses staff role checks. Self-scoped resources (`/profile`, `/settings`) carry no `authorize` — the subject is `ctx.principal`.
- **DB** (ADR-0006/0008, both now delta-superseded by ADR-0061 for the connection alone): schema in `packages/db/src/schema`, migrations generated with `drizzle-kit generate` and committed, never `push`; the API never auto-migrates; seeds are idempotent. **Two roles**: the API connects as the application role (`DATABASE_URL`) with table privileges and no DDL; `packages/db`'s tooling connects as the owner (`DATABASE_URL_OWNER`, required with no fallback). `audit_events` is append-only in the database as well as in the lint rule — a revoked grant and a `BEFORE UPDATE OR DELETE` trigger — so retention is a reviewed migration, never a job. Per-population data gets a table per population with a real foreign key (ADR-0045, now **delta-superseded by ADR-0053** — its two tables, merge rules and adapter all stand; only where the theme control renders and the settings core's key list changed), not a discriminated table — `sessions` is the one exception and says why.
- **Infrastructure seams** (ADR-0066, which delta-supersedes 0013, 0016 and 0020): mail goes through the `MailSender` port in `core/mail` (`MAIL_TRANSPORT=log|smtp`) and never through a client a service imports; `GET /metrics` lives in `core/metrics`, beside `/health` and above every limiter, labelled by route **pattern** and behind `METRICS_TOKEN`; the error reporter in `core/reporting` fires on **5xx only** and is given the request id, route, status and principal — never the body; the four rate limiters take one store built in `core/rate-limit`, Redis when `REDIS_URL` is set and memory otherwise, failing closed. All four are off or inert in a default clone, and production must state `MAIL_TRANSPORT` and `METRICS_TOKEN`.
- **Logging** (ADR-0005): pino via `ctx.logger`; fields object first, short static message second; no `console.*`.
- **Contracts** (ADR-0023): `@repo/contracts` depends only on `zod`; enums are defined once there and consumed by `pgEnum` and zod; the list-query language (ADR-0014) and its codec live there too.
- **Tests** (ADR-0021): unit tests with fake repositories as plain objects; integration tests through `createApp(buildContainer({ db: testDb }))` + supertest against `DATABASE_URL_TEST`; every new endpoint gets both, plus Postman via `/postman-sync`.
- **Lint is the mechanical half** (ADR-0002): `packages/config-eslint/api.js` already fails the build on classes, raw responses, `process.env` and layer-crossing imports — a rule a reviewer keeps catching belongs there.
