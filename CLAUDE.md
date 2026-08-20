# machxi-starter — guidance for Claude

Blueprint monorepo (Turborepo + pnpm) for projects that need an API, an admin panel and a web app. **Architecture is decided in `docs/adr/` — read the relevant ADR before changing anything it covers.** Index: `docs/adr/README.md`. Build order and endpoint scope: the deliverable plans in `docs/plan/`, starting from the ledger `docs/plan/README.md`.

Work is staged into numbered **deliverables** (ADR-0025), one plan file each, steps written `D<n>.<step>`. **D1 shipped 2026-08-18, D2 2026-08-19, D3 (admin panel) 2026-08-20; D4 (data grid v2) is in progress** — `docs/plan/0004-data-grid-v2.md`. ADRs 0001–0036 are closed. ADRs 0037–0042 were written for D4 and are the amendable set, but they are still `proposed`: each is accepted at the head of its own implementing step, so **a step whose ADR is still `proposed` is gated and must not be started**.

## Non-negotiables (from the ADRs)

- **Functional style, no OOP** (ADR-0009): no `class`, no `this`, no decorators, no DI container. Every layer is `create<Module><Layer>(deps)` returning an `as const` object; types via `ReturnType`. Wrap third-party constructors in `create*` functions.
- **Layers** (ADR-0009): `*.routes.ts` → `*.controller.ts` → `*.service.ts` → `*.repository.ts`. Services never import Express or SQL; repositories hold all Drizzle queries; controllers only parse `req.valid`, call the service with `req.ctx` first, and respond via `respond.*`.
- **Envelope** (ADR-0012): controllers use only `respond.ok / created / list / noContent`; never `res.json` outside `apps/api/src/core/http`.
- **Errors** (ADR-0013): one branded `AppError`; throw via factories (`notFound()`, `forbidden()`, module `*.errors.ts`); check with `isAppError(e)` + `e.code`; never `instanceof`, never new error classes.
- **Config** (ADR-0004): `process.env` only in `core/config`, `packages/db/src/tooling/env.ts`, `scripts/postman.mjs` and the `apps/api/test/` harness. Every new variable → zod schema + `.env.example`.
- **Context** (ADR-0010): services take `ctx: RequestContext` as first parameter; `getContext()` is for infrastructure only.
- **Validation** (ADR-0011): zod schemas live in `@repo/contracts` and are re-exported by `<module>.schemas.ts`; controllers read `req.valid.{params,query,body}` only.
- **Auth** (ADR-0017–0019): two populations (`staff`, `user`), separate tables, separate segments `/api/v1/{public,user,admin}`; `authenticate()` at router level, `authorize()` at mount; `super_admin` bypasses staff role checks.
- **DB** (ADR-0006/0008): schema in `packages/db/src/schema`, migrations generated with `drizzle-kit generate` and committed, never `push`; API never auto-migrates; seeds are idempotent.
- **Logging** (ADR-0005): pino via `ctx.logger`; fields object first, short static message second; no `console.*`.
- **Contracts** (ADR-0023): `@repo/contracts` depends only on `zod`; enums are defined once there and consumed by `pgEnum` and zod.
- **Deliverables and the ADR window** (ADR-0025): an ADR may be amended in place only while the deliverable it belongs to is `in progress` in `docs/plan/README.md`. **ADRs 0001–0036 are frozen** (D1, D2 and D3 shipped) — diverging from one means writing a superseding ADR, never editing it, and that now includes every frontend decision D3 made (0030–0036). ADRs 0037–0042 were written for D4 and are amendable in place, labelled `**Amended YYYY-MM-DD (D4.<step>).**`, while D4 is in progress.
- **Task caching** (ADR-0026): a task whose result depends on anything outside the repo is never cached and declares its `env`. `pnpm test` includes the integration tier, so it is `cache: false` and runs `--concurrency=1`; `pnpm test:unit` is the cached fast loop.
- **Frontend (ADRs 0030–0036, now frozen — read `/frontend-conventions` before touching `apps/admin` or `packages/ui`; D4's 0037–0042 are what may still change)**: shadcn/ui design system in `@repo/ui` on Tailwind v4, reached through the single `shared/ui` door (0031); FSD layers with lint-enforced downward-only imports and TanStack Router file-based routes (0032); credentials in memory only — no token, CSRF token or principal in `localStorage`, `sessionStorage` or a client-set cookie, though non-credential display state may be persisted — single-flight refresh, CSRF via the 0030 bootstrap endpoint, and the client never _reads_ `document.cookie` (0033); TanStack Query owns all server state, list state in URL search params, outcomes declared in typed mutation `meta` and delivered by one global handler, queries silent and therefore rendering their own failure panel (0034); one `ResourceConfig` per resource — serializable config + named registries — for both AppGrid (TanStack Table v9 in manual mode over shadcn `Table`) and config-driven RHF forms over the contracts zod schemas, every field disabled while a mutation is pending (0035); Vitest + Testing Library + MSW with handlers derived from `@repo/contracts`, no live-API tier (0036).
  - Two rules the D3 steps had to discover, worth knowing before the third resource: **operator-facing copy has exactly two catalogues** — error _codes_ in `shared/notifications/messages.ts`, field _rules_ in the contracts schema itself, and the API's own `error.message` is never rendered; and **a mutation invalidates its own entity's keys, while the feature invalidates whatever else the interaction touched** (an entity may not import another entity).

## Commands

```
pnpm i                         # Node 22, pnpm 10 (corepack enable)
cp .env.example .env
cp apps/admin/.env.example apps/admin/.env   # apps/admin reads its own (ADR-0033)
pnpm docker:up                 # Postgres 16 (docker/local/compose.yaml)
pnpm db:setup                  # migrate + seed super admin (from SEED_SUPER_ADMIN_* in .env)
pnpm db:seed -- --dev          # dev fixtures (manager/editor staff, customer users)
pnpm dev --filter api          # http://localhost:4000
pnpm dev --filter admin        # http://localhost:3001 (needs the API up)
pnpm check                     # fast inner loop: lint + check-types + test:unit, one cached parallel turbo run
pnpm test:unit                 # unit tests alone, cached, no database
pnpm lint && pnpm check-types && pnpm test   # the gate: test includes integration, needs Postgres up
pnpm test:int --filter api     # integration tests only, against DATABASE_URL_TEST
pnpm test:postman              # newman over docs/postman
```

## Repo map

- `apps/api` — Express 5 API (`src/core`, `src/modules/<feature>`, `src/routes/{public,user,admin}.router.ts`, `src/core/container.ts` composition root)
- `apps/admin` (Vite + React SPA, port 3001) — shipped in D3 and **the D4 build target**: `src/{app,pages,widgets,features,entities,shared}` per ADR-0032, resources under `entities/` + `features/<x>-manage/` + a thin `pages/<x>/`, machinery in `shared/{api,form,grid,resource,ui,notifications}`; `apps/web` (Next.js) — out of scope until D5
- `packages/db` (Drizzle schema, migrations, seeds), `packages/contracts`, `packages/crypto`, `packages/logger`, `packages/config-*`, `packages/ui`
- `docker/local` — compose for local dev; `docs/` — ADRs, plan, Postman
- `scripts/` — repo-level tooling outside the workspaces, so **not** covered by `turbo run lint` / `check-types` (ADR-0002); today only `postman.mjs`

## Search

Use the Grep/Glob tools to search this repo; never `grep -r`, `find` or `rg` through Bash. Those ignore `.gitignore` and walk `node_modules` and `.turbo`, which is slow and floods the context — `.claude/settings.json` denies them for that reason. Single-file reads (`cat`, `sed -n`) are fine.

## Workflow expectations

1. Before implementing: identify the ADRs involved; if a change conflicts with one, check its deliverable in `docs/plan/README.md`. In progress → amend in place, labelled `**Amended YYYY-MM-DD (D<n>.<step>).**`. Shipped → stop and propose a superseding ADR instead of diverging (ADR-0024 rule 1, ADR-0025 rule 2).
2. Use the project skills — they encode the ADR checklists. API and data: `/api-conventions`, `/new-api-module`, `/add-endpoint`, `/db-schema-change`, `/postman-sync`. Admin app: `/frontend-conventions`, `/new-resource-ui`, `/ui-component`. Everything else: `/new-adr`, `/plan-step`, `/local-dev`.
3. Every change ends green on `pnpm lint && pnpm check-types && pnpm test`; new endpoints get integration tests (ADR-0021) and Postman requests.
4. Keep docs in sync: new env var → ADR-0004 + `.env.example` + `turbo.json` `env` if a task reads it (ADR-0026); new endpoint → the current plan's scope + Postman; new decision → ADR + index (with its `D<n>.<step>` in the _Implemented_ column).
5. Commit messages: conventional commits (`feat(api): …`, `chore(db): …`, `docs(adr): …`).
6. Ask before: deleting migrations, changing the envelope/error shape, adding a runtime dependency to `@repo/contracts`, or introducing any auth library.

## Subagents

`.claude/agents/`: `adr-reviewer` (diff vs ADRs), `module-builder` (scaffold API feature modules), `ui-builder` (admin screens, shared UI machinery, design-system primitives), `db-migrator` (schema → migration → contracts → seeds), `test-engineer` (Vitest unit/integration), `security-reviewer` (auth/session/input), `adr-author` (new/superseding ADRs). Use them for the matching task; run `adr-reviewer` and `security-reviewer` before opening a PR that touches `apps/api/src/core` or auth.
