---
name: new-api-module
description: Step-by-step checklist to create a new API feature module (routes/controller/service/repository/schemas/mapper/errors/tests) per ADR-0009 and wire it into the container, segment routers, contracts and Postman. Use for "add a <feature> module".
---

# New API module — `$ARGUMENTS` (module name, kebab-case)

Read `/api-conventions` first. Mirror an existing module (`apps/api/src/modules/users`) for exact style.

## 1. Contracts (`packages/contracts/src/<module>/`)

- [ ] `schemas.ts`: zod for params (`idParams`), bodies (`.strict()`, max lengths), list query (`listQuerySchema({ sortable: [...] as const, filterable: {...}, defaultSort: '-createdAt' })`).
- [ ] `types.ts`: `<X>Resource` (wire shape; no DB types), inferred DTOs.
- [ ] Export from `packages/contracts/src/index.ts`. Add new enums as `as const` arrays + unions.

## 2. DB (only if a new aggregate) — run `/db-schema-change`.

## 3. Module files (`apps/api/src/modules/<module>/`)

- [ ] `<m>.schemas.ts` — re-export contracts schemas.
- [ ] `<m>.errors.ts` — domain factories built on `core/errors` (`conflict('…', 'X_CODE')`), add codes to contracts `ErrorCode`.
- [ ] `<m>.mapper.ts` — `to<X>Resource(row)`, pure; strips internals.
- [ ] `<m>.repository.ts` — `create<X>Repository(db)`: `findById`, `findMany(listQuery)`→`Page<Row>` via `applyListQuery`, `insert`, `update`, … each with `tx: DbExecutor = db` last; map unique violations to domain errors.
- [ ] `<m>.service.ts` — `create<X>Service({ repo, db, ... })`: `(ctx, ...)` functions; ownership/role policies via `core/auth/policies`; transactions via `db.transaction`.
- [ ] `<m>.controller.ts` — `create<X>Controller(svc)`: one function per endpoint; `respond.*` only.
- [ ] `<m>.routes.ts` — `create<X>Router(c)`: `validate(schema)` per route; no logic.
- [ ] `index.ts` (optional) exporting factories + types.

## 4. Wiring

- [ ] `core/container.ts`: repo → service → controller in dependency order; add to `services`/`controllers`.
- [ ] Mount in `routes/admin.router.ts` (`r.use('/<plural>', authorize('admin', ...), create<X>Router(c.controllers.<x>))`) and/or `user.router.ts` / `public.router.ts`.

## 5. Tests (ADR-0021)

- [ ] `__tests__/<m>.service.test.ts` — fake repository literals; success + each error path.
- [ ] `__tests__/<m>.mapper.test.ts` — strips internals.
- [ ] `__tests__/<m>.int.test.ts` — supertest per endpoint: happy, 400 validation, 401 no token, 403 wrong role/population, 404; list: pagination/sort/filter/invalid sort.

## 6. Docs & tooling

- [ ] `/postman-sync` — add folder + requests + tests.
- [ ] the current deliverable plan in `docs/plan/` endpoint scope (if new), env vars → ADR-0004 + `.env.example`.
- [ ] `pnpm check && pnpm test:int --filter api` green.

Report created files and open questions (e.g. role assignments not specified).
