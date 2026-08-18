# machxi-starter — guidance for Claude

Blueprint monorepo (Turborepo + pnpm) for projects that need an API, an admin panel and a web app. **Architecture is decided in `docs/adr/` — read the relevant ADR before changing anything it covers.** Index: `docs/adr/README.md`. Build order and endpoint scope: `docs/implementation-plan.md`.

## Non-negotiables (from the ADRs)

- **Functional style, no OOP** (ADR-0009): no `class`, no `this`, no decorators, no DI container. Every layer is `create<Module><Layer>(deps)` returning an `as const` object; types via `ReturnType`. Wrap third-party constructors in `create*` functions.
- **Layers** (ADR-0009): `*.routes.ts` → `*.controller.ts` → `*.service.ts` → `*.repository.ts`. Services never import Express or SQL; repositories hold all Drizzle queries; controllers only parse `req.valid`, call the service with `req.ctx` first, and respond via `respond.*`.
- **Envelope** (ADR-0012): controllers use only `respond.ok / created / list / noContent`; never `res.json` outside `apps/api/src/core/http`.
- **Errors** (ADR-0013): one branded `AppError`; throw via factories (`notFound()`, `forbidden()`, module `*.errors.ts`); check with `isAppError(e)` + `e.code`; never `instanceof`, never new error classes.
- **Config** (ADR-0004): `process.env` only in `core/config`, `drizzle.config.ts`, and the seed runner. Every new variable → zod schema + `.env.example`.
- **Context** (ADR-0010): services take `ctx: RequestContext` as first parameter; `getContext()` is for infrastructure only.
- **Validation** (ADR-0011): zod schemas live in `@repo/contracts` and are re-exported by `<module>.schemas.ts`; controllers read `req.valid.{params,query,body}` only.
- **Auth** (ADR-0017–0019): two populations (`staff`, `user`), separate tables, separate segments `/api/v1/{public,user,admin}`; `authenticate()` at router level, `authorize()` at mount; `super_admin` bypasses staff role checks.
- **DB** (ADR-0006/0008): schema in `packages/db/src/schema`, migrations generated with `drizzle-kit generate` and committed, never `push`; API never auto-migrates; seeds are idempotent.
- **Logging** (ADR-0005): pino via `ctx.logger`; fields object first, short static message second; no `console.*`.
- **Contracts** (ADR-0023): `@repo/contracts` depends only on `zod`; enums are defined once there and consumed by `pgEnum` and zod.

## Commands

```
pnpm i                         # Node 22, pnpm 10 (corepack enable)
cp .env.example .env
pnpm docker:up                 # Postgres 16 (docker/local/compose.yaml)
pnpm db:setup                  # migrate + seed super admin (from SEED_SUPER_ADMIN_* in .env)
pnpm db:seed -- --dev          # dev fixtures (manager/editor staff, customer users)
pnpm dev --filter api          # http://localhost:4000
pnpm lint && pnpm check-types && pnpm test
pnpm test:int --filter api     # integration tests against DATABASE_URL_TEST
pnpm test:postman              # newman over docs/postman
```

## Repo map

- `apps/api` — Express 5 API (`src/core`, `src/modules/<feature>`, `src/routes/{public,user,admin}.router.ts`, `src/core/container.ts` composition root)
- `apps/admin` (Vite + React), `apps/web` (Next.js) — out of scope until the API deliverable is done
- `packages/db` (Drizzle schema, migrations, seeds), `packages/contracts`, `packages/crypto`, `packages/logger`, `packages/config-*`, `packages/ui`
- `docker/local` — compose for local dev; `docs/` — ADRs, plan, Postman
- `scripts/` — repo-level tooling outside the workspaces, so **not** covered by `turbo run lint` / `check-types` (ADR-0002); today only `postman.mjs`

## Search

Use the Grep/Glob tools to search this repo; never `grep -r`, `find` or `rg` through Bash. Those ignore `.gitignore` and walk `node_modules` and `.turbo`, which is slow and floods the context — `.claude/settings.json` denies them for that reason. Single-file reads (`cat`, `sed -n`) are fine.

## Workflow expectations

1. Before implementing: identify the ADRs involved; if a change conflicts with one, stop and propose an ADR amendment/supersession instead of diverging.
2. Use the project skills (`/new-api-module`, `/add-endpoint`, `/db-schema-change`, `/new-adr`, `/plan-step`, `/postman-sync`, `/local-dev`, `/api-conventions`) — they encode the ADR checklists.
3. Every change ends green on `pnpm lint && pnpm check-types && pnpm test`; new endpoints get integration tests (ADR-0021) and Postman requests.
4. Keep docs in sync: new env var → ADR-0004 + `.env.example`; new endpoint → `docs/implementation-plan.md` scope + Postman; new decision → ADR + index.
5. Commit messages: conventional commits (`feat(api): …`, `chore(db): …`, `docs(adr): …`).
6. Ask before: deleting migrations, changing the envelope/error shape, adding a runtime dependency to `@repo/contracts`, or introducing any auth library.

## Subagents

`.claude/agents/`: `adr-reviewer` (diff vs ADRs), `module-builder` (scaffold feature modules), `db-migrator` (schema → migration → contracts → seeds), `test-engineer` (Vitest unit/integration), `security-reviewer` (auth/session/input), `adr-author` (new/superseding ADRs). Use them for the matching task; run `adr-reviewer` and `security-reviewer` before opening a PR that touches `apps/api/src/core` or auth.
