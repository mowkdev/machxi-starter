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
- **DB** (ADR-0006/0008): schema in `packages/db/src/schema`, migrations generated with `drizzle-kit generate` and committed, never `push`; the API never auto-migrates; seeds are idempotent. Per-population data gets a table per population with a real foreign key (ADR-0045), not a discriminated table — `sessions` is the one exception and says why.
- **Logging** (ADR-0005): pino via `ctx.logger`; fields object first, short static message second; no `console.*`.
- **Contracts** (ADR-0023): `@repo/contracts` depends only on `zod`; enums are defined once there and consumed by `pgEnum` and zod; the list-query language (ADR-0014) and its codec live there too.
- **Tests** (ADR-0021): unit tests with fake repositories as plain objects; integration tests through `createApp(buildContainer({ db: testDb }))` + supertest against `DATABASE_URL_TEST`; every new endpoint gets both, plus Postman via `/postman-sync`.
- **Lint is the mechanical half** (ADR-0002): `packages/config-eslint/api.js` already fails the build on classes, raw responses, `process.env` and layer-crossing imports — a rule a reviewer keeps catching belongs there.
