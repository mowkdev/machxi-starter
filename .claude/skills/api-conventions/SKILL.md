---
name: api-conventions
description: Quick reference of the machxi API conventions (layering, envelope, errors, pagination, routes, auth, config, logging) condensed from the ADRs. Load before writing or reviewing any code under apps/api or packages/contracts.
---

# API conventions (condensed from docs/adr — ADRs win on conflict)

## Layers (ADR-0009) — functional only

```
modules/<m>/<m>.routes.ts      createXRouter(c)          Router; validate(); guards; c.handler
modules/<m>/<m>.controller.ts  createXController(svc)    (req,res) => respond.*(res, await svc.f(req.ctx, req.valid.*))
modules/<m>/<m>.service.ts     createXService(deps)      (ctx, ...) => domain; throws AppError factories
modules/<m>/<m>.repository.ts  createXRepository(db)     (args, tx: DbExecutor = db) => Drizzle
modules/<m>/<m>.schemas.ts     re-exports @repo/contracts schemas (+ server-only refinements)
modules/<m>/<m>.mapper.ts      toXResource(row) pure
modules/<m>/<m>.errors.ts      domain error factories, e.g. emailTaken()
```

Types: `export type XService = ReturnType<typeof createXService>`. Wire in `core/container.ts`. No classes/`this`/decorators.

## Envelope (ADR-0012)

- `{ success: true, data, meta: { requestId } }` · list: `data: T[]`, `meta.pagination: { offset, limit, total }`, `meta.sort`, `meta.filters` · error: `{ success: false, error: { code, message, details? }, meta }`
- Helpers only: `respond.ok(res, data, status=200)`, `respond.created`, `respond.list(res, page)`, `respond.noContent`. 201 create, 204 delete/logout/no-body.

## Errors (ADR-0013)

- `appError({ status, code, message, details?, expose?, cause? })`; generic factories `validation()`, `unauthenticated()`, `forbidden()`, `notFound()`, `conflict()`, `rateLimited()`, `internal()`, `unavailable()`; module factories set specific codes (`AUTH_INVALID_CREDENTIALS`, `USER_EMAIL_TAKEN`).
- Codes `SCREAMING_SNAKE`, union in `@repo/contracts`. Detect with `isAppError(e)`. Zod → 400 `VALIDATION_ERROR` with `details[{path,message,code}]`. Unknown → 500 generic; stack only in development.

## Lists (ADR-0014)

`?offset=0&limit=20&sort=-createdAt,email&filter[status]=active&filter[createdAt][gte]=…&filter[status][in]=a,b&filter[email][like]=…&filter[x][null]=true&q=`

- `listQuerySchema({ sortable, filterable, defaultSort, maxLimit? })` → `ListQuery`; repo uses `applyListQuery(qb, query, columnMap)`; service returns `Page<T>`; always tiebreak `id asc`; hard cap limit 100.

## Routes (ADR-0015, route segments) and auth (ADR-0017, identity model; ADR-0019, authorization guards)

- `/health/{live,ready}`, `/api/v1/public/*`, `/api/v1/user/*` (`authenticate('user')` at router), `/api/v1/admin/*` (`authenticate('staff')`), auth endpoints under `/{user|admin}/auth/{login,refresh,logout,logout-all,me}`; `/public/auth/register`.
- `authorize(...roles)` at mount for admin resources; `super_admin` bypass; UUID-validate `:id`; PATCH for partial updates.
- Principal: `{ kind: 'staff'|'user', id, roles, sessionId }` on `req.ctx.principal`. JWT access 15m (`jose`, HS256, `aud` per population, `sid` claim) + opaque rotating refresh (sha256 hash in `sessions`).

## Context (ADR-0010) · Config (ADR-0004) · Logging (ADR-0005)

- `req.ctx: { requestId, logger, principal, locale, ip, userAgent }`; services take `ctx` first; `getContext()` only in infra.
- Config: zod `envSchema` in `core/config`; grouped `config.{http,db,auth,log}`; new var → schema + `.env.example` + ADR-0004.
- `ctx.logger.info({ userId }, 'short static msg')`; levels: error 5xx, warn expected failures, info lifecycle, debug detail; redaction is automatic for password/token fields.

## DB (ADR-0006/0008) · Contracts (ADR-0023)

- Drizzle + postgres.js, `casing: 'snake_case'`; uuid v7 ids; `created_at/updated_at`; enums from `@repo/contracts` arrays; migrations generated + committed; seeds idempotent; API never auto-migrates.
- `@repo/contracts`: zod schemas, resource types, enums, envelope/error types; depends only on zod.

## Tests (ADR-0021)

Vitest; unit = service + fake repo object literals; int = supertest + `DATABASE_URL_TEST`; every endpoint: happy + 400/401/403/404; auth suite parameterised by population.
