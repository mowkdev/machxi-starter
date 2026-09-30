---
name: new-api-module
description: Step-by-step checklist to create a new API feature module (routes/controller/service/repository/schemas/mapper/errors/tests) per ADR-0009 and wire it into the container, segment routers, contracts and Postman. Use for "add a <feature> module".
---

# New API module — `$ARGUMENTS` (module name, kebab-case)

## 0. Run the generator first

```
pnpm turbo gen api-module
```

It asks for the aggregate (singular, lower case), its plural, the route segment and whether the aggregate is owned by an organization (ADR-0067 §1 — the tenant column, its composite index, a required scope on every repository function, and the table's row-level policies with a repository that never runs on the bare pool, ADR-0078 §4, row-level security; answer `yes` only when it is, because retrofitting it is a rewrite).

**The templates in `turbo/generators/templates/api-module/` are the description of a module** (ADR-0063 §3). When the shape changes, the template changes in the same step — a shape that lives only in this document decays, because nothing runs it.

The generator writes the contract folder and its barrel entry, the Drizzle table and both hand-maintained table enumerations (the ESLint import ban and `TRUNCATED_TABLES`, ADR-0061 §4), the `@repo/db` barrel export, the eight module files of ADR-0009 and the unit and index tests — then runs prettier over what it wrote and prints the rest. Read `/api-conventions` for the conventions the templates encode; mirror `apps/api/src/modules/users` where a question the templates do not answer comes up.

**Everything below is what the generator deliberately does not do**, because each of them is a decision rather than a shape. Sections 1–3 are the seeded files you now replace with the real domain; sections 4–6 are the edits it printed.

## 1. Contracts (`packages/contracts/src/<module>/`) — seeded, now make them true

- [ ] `schemas.ts`: zod for params (`idParams`), bodies (`.strict()`, max lengths), list query (`listQuerySchema({ sortable: [...] as const, filterable: {...}, defaultSort: '-createdAt' })`). A field enters `sortable`/`filterable` **only with the index that serves it** (ADR-0060 §3) — the generated `<m>.list-indexes.test.ts` is what refuses the pair.
- [ ] `types.ts`: `<X>Resource` (wire shape; no DB types), inferred DTOs.
- [ ] New enums as `as const` arrays + unions (the barrel export is already written).

## 2. DB — the migration is yours: run `/db-schema-change`.

The table is generated; the SQL is not. `pnpm db:generate`, review, `pnpm db:migrate` — migrations come from drizzle-kit and never from a template (ADR-0006).

## 3. Module files (`apps/api/src/modules/<module>/`) — seeded, now make them true

- [ ] `<m>.schemas.ts` — re-export contracts schemas.
- [ ] `<m>.errors.ts` — domain factories built on `core/errors` (`conflict('…', 'X_CODE')`), add codes to contracts `ErrorCode`.
- [ ] `<m>.mapper.ts` — `to<X>Resource(row)`, pure; strips internals.
- [ ] `<m>.repository.ts` — `create<X>Repository(db)`: `findById`, `findMany(listQuery)`→`Page<Row>` via `applyListQuery`, `insert`, `update`, … each with `tx: DbExecutor = db` last; map unique violations to domain errors.
- [ ] `<m>.service.ts` — `create<X>Service({ repo, db, ... })`: `(ctx, ...)` functions; ownership/role policies via `core/auth/policies`; transactions via the root's transaction helper handed in through `wire.ts` (`deps.transaction`), never `db.transaction` — the helper places the request's tenant scope and retries a deadlock victim (ADR-0078 §3 and §4, the deadlock retry and row-level security), and a bare `db.transaction` does neither.
- [ ] `<m>.controller.ts` — `create<X>Controller(svc)`: one function per endpoint; `respond.*` only.
- [ ] `<m>.routes.ts` — `create<X>Router(c)`: `validate(schema)` per route; no logic.
- [ ] `wire.ts` — **generated**: `wireX(deps)` returning `{ repositories, services, controllers }`; grow its deps as the module takes on another module's service, the audit writer or the mail port. No Express and no schema tables — the lint rule treats it as a service (ADR-0073, review hardening — the composition root wired per module).
- [ ] `index.ts` (optional) exporting factories + types, `wireX` included.

## 4. Wiring

- [ ] `core/container.ts`: one `const x = wireX(...)` line in construction order, then its entries in the returned `repositories`/`services`/`controllers` maps. The repo → service → controller order lives in `wire.ts`, not here.
- [ ] Mount in `routes/admin.router.ts` (`r.use('/<plural>', authorize('admin', ...), create<X>Router(c.controllers.<x>))`) and/or `user.router.ts` / `public.router.ts`.

## 5. Tests (ADR-0021)

- [ ] `__tests__/<m>.service.test.ts` — **generated**, one case per seeded path; grow it as the service does: fake repository literals, success + each error path.
- [ ] `__tests__/<m>.list-indexes.test.ts` — **generated** and needs no edit: it reads the repository's own `ColumnMap` against the allow-lists, so it only reddens when the two disagree (ADR-0060 §3).
- [ ] `__tests__/<m>.mapper.test.ts` — yours: strips internals.
- [ ] `__tests__/<m>.int.test.ts` — yours, because it is written against endpoints that exist: supertest per endpoint: happy, 400 validation, 401 no token, 403 wrong role/population, 404; list: pagination/sort/filter/invalid sort.

## 6. Docs & tooling

- [ ] `/postman-sync` — add folder + requests + tests.
- [ ] the current deliverable plan in `docs/plan/` endpoint scope (if new), env vars → ADR-0004 + `.env.example`.
- [ ] `pnpm check && pnpm test:int --filter api` green.

Report created files and open questions (e.g. role assignments not specified).
