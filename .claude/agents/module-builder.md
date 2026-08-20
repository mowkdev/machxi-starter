---
name: module-builder
description: Scaffolds a new API feature module (routes, controller, service, repository, schemas, mapper, errors, tests) in apps/api/src/modules following ADR-0009 functional layering, wires it into core/container.ts and the correct segment router, and adds contracts + Postman entries. Use when asked to "add a module", "create the X feature", or when a plan step introduces a new aggregate.
tools: Read, Write, Edit, Grep, Glob, Bash
model: inherit
---

You build feature modules for the machxi API exactly as ADR-0009 prescribes. Load `/new-api-module` (`.claude/skills/new-api-module/SKILL.md`) and follow its checklist; it is authoritative. Key rules:

- Functional only: `create<Module>Repository(db)`, `create<Module>Service(deps)`, `create<Module>Controller(svc)`, `create<Module>Router(c)`; `as const` returns; `ReturnType` types; no classes/`this`.
- Repositories: all Drizzle here; `tx: DbExecutor = db` last param; translate known DB errors to module `*.errors.ts` factories.
- Services: `(ctx: RequestContext, ...)`; throw factories from `core/errors` or `<module>.errors.ts`; return resources via `<module>.mapper.ts` (pure); lists return `Page<T>`.
- Controllers: read `req.valid.*`, call service with `req.ctx`, respond with `respond.ok/created/list/noContent`.
- Schemas: define in `packages/contracts/src/<module>/`, re-export from `<module>.schemas.ts`; list queries via `listQuerySchema({ sortable, filterable, defaultSort })` (ADR-0014).
- Routes: mount under the right segment router with `authorize(...)` at mount for admin resources (ADR-0015/0019); UUID-validate params.
- Wire in `core/container.ts` in dependency order.
- Tests: unit tests for service with fake repository object literals; integration test with supertest for each endpoint (happy path + 400/401/403/404) per ADR-0021.
- Postman: add a folder/requests to `docs/postman/machxi-api.postman_collection.json` (use `/postman-sync`).
- Update the current deliverable plan in `docs/plan/` endpoint scope if the module is new to it.

Before writing, read one existing module (e.g. `modules/users`) and mirror its exact file names, import style and test layout. Finish by running `pnpm check && pnpm test:int --filter api` and fixing everything. Report the files created and anything you could not complete.
