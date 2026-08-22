# machxi-starter — guidance for Claude

Blueprint monorepo (Turborepo + pnpm) for projects that need an API, an admin panel and a web app. **Architecture is decided in `docs/adr/` — read the relevant ADR before changing anything it covers.** Index: `docs/adr/README.md`. Build order and endpoint scope: the deliverable plans in `docs/plan/`, starting from the ledger `docs/plan/README.md`.

Work is staged into numbered **deliverables** (ADR-0025), one plan file each, steps written `D<n>.<step>`. **D1 shipped 2026-08-18, D2 2026-08-19, D3 (admin panel) 2026-08-20, D4 (data grid v2) 2026-08-21, D5 (grid URL readability) 2026-08-22, D6 (user settings) 2026-08-22** — `docs/plan/0006-user-settings.md`. **D7 (interface localization) opened 2026-08-22** — `docs/plan/0007-localization.md`, steps `D7.1`–`D7.7`. **ADRs 0001–0045 are closed**; the one open window holds **ADR-0046** alone, **accepted 2026-08-22 at the head of `D7.1`** and amendable in place while D7 is `in progress` — a step whose ADR is still `proposed` is gated and must not be started. D5's insertion renumbered the planned rows: localization is D7, the customer app D8, impersonation D9, the marketing site D10.

## Rules that always apply

- **Deliverables and the ADR window** (ADR-0025): an ADR may be amended in place only while the deliverable it belongs to is `in progress` in `docs/plan/README.md`. **ADRs 0001–0045 are frozen** (D1–D6 shipped) — diverging from one means writing a superseding ADR that carries the whole decision, never editing it. **ADR-0046 (interface localization) is the only amendable ADR**, while D7 is in progress; amendments are labelled `**Amended YYYY-MM-DD (D7.N).**`. ADRs 0034 and 0040 are `superseded by` and out of force: read their successors.
- **Task caching** (ADR-0026): a task whose result depends on anything outside the repo is never cached and declares its `env`. `pnpm test` includes the integration tier, so it is `cache: false` and runs `--concurrency=1`; `pnpm check` (lint + check-types + test:unit) is the cached fast loop.
- **The domain rules load with the files**: `.claude/rules/api.md` when you touch `apps/api` or the data packages, `.claude/rules/frontend.md` when you touch `apps/admin` or `packages/ui`. They are the ADR non-negotiables condensed; if you are reading this without them and about to edit those paths, open the rule file first.

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
- `apps/admin` (Vite + React SPA, port 3001): `src/{app,pages,widgets,features,entities,shared}` per ADR-0032, resources under `entities/` + `features/<x>-manage/` + a thin `pages/<x>/`, machinery in `shared/{api,form,grid,resource,ui,notifications,i18n}`; `apps/web` (Next.js) — marketing only, built last (D10); the user-facing product is the planned `apps/customer` Vite SPA (D8)
- `packages/db` (Drizzle schema, migrations, seeds), `packages/contracts`, `packages/crypto`, `packages/logger`, `packages/config-*`, `packages/ui`
- `docker/local` — compose for local dev; `docs/` — ADRs, plan, Postman; `scripts/` — repo-level tooling outside the workspaces (ADR-0002)

## Search

Use the Grep/Glob tools to search this repo; never `grep -r`, `find` or `rg` through Bash — they walk `node_modules` and `.turbo`, and `.claude/settings.json` denies them. Single-file reads (`cat`, `sed -n`) are fine.

## Workflow expectations

1. Before implementing: identify the ADRs involved; if a change conflicts with one, check its deliverable in `docs/plan/README.md`. In progress → amend in place, labelled. Shipped → stop and propose a superseding ADR instead of diverging (ADR-0024 rule 1, ADR-0025 rule 2).
2. Use the project skills — they encode the ADR checklists. API and data: `/api-conventions`, `/new-api-module`, `/add-endpoint`, `/db-schema-change`, `/postman-sync`. Admin app: `/frontend-conventions`, `/new-resource-ui`, `/ui-component`. Process: `/plan-deliverable` (decide, ahead of opening), `/plan-step` (build one step at the desk), `/run-deliverable` (build unattended, in a worktree), `/new-adr`, `/local-dev`.
3. Every change ends green on `pnpm lint && pnpm check-types && pnpm test`; new endpoints get integration tests (ADR-0021) and Postman requests.
4. Keep docs in sync: new env var → ADR-0004 + `.env.example` + `turbo.json` `env`; new endpoint → the current plan's scope + Postman; new decision → ADR + index (with its `D<n>.<step>` in the _Implemented_ column).
5. Commit messages: conventional commits (`feat(api): …`, `chore(db): …`, `docs(adr): …`). Commit by explicit path when another session may share the tree; unattended runs work in a worktree on their own branch and open a PR.
6. Ask before: deleting migrations, changing the envelope/error shape, adding a runtime dependency to `@repo/contracts`, or introducing any auth library.

## Subagents and workflows

`.claude/agents/`: `adr-reviewer`, `security-reviewer` (both read-only), `module-builder`, `ui-builder`, `db-migrator`, `test-engineer`, `adr-author`, `gate-runner` (haiku; runs `pnpm check` or the gate, reports pass/fail only). `.claude/workflows/` — invoke by `scriptPath`, never by name: `step-review` (gate ∥ reviewers, BLOCKER/MAJOR findings refuted once, returns its own precision), `deliverable-plan` (analyse → the operator's questions → draft ADRs and build order → open, mechanically), `deliverable-build` (every pending step in order — build, `step-review`, fix, commit — close, push the branch, open the PR, and chain only when `deliverable-plan` says ready). The v1 scripts `review-step`, `run-deliverable`, `plan-deliverable` are kept as the reference they were measured against; see `.claude/README.md`.
