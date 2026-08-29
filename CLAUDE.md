# machxi-starter — guidance for Claude

Blueprint monorepo (Turborepo + pnpm) for projects that need an API, an admin panel and a web app. **Architecture is decided in `docs/adr/` — read the relevant ADR before changing anything it covers.** Index: `docs/adr/README.md`. Build order and endpoint scope: the deliverable plans in `docs/plan/`, starting from the ledger `docs/plan/README.md`.

Work is staged into numbered **deliverables** (ADR-0025), one plan file each, steps written `D<n>.<step>`. **D1 shipped 2026-08-18, D2 2026-08-19, D3 (admin panel) 2026-08-20, D4 (data grid v2) 2026-08-21, D5 (grid URL readability) 2026-08-22, D6 (user settings) 2026-08-22, D7 (interface localization) 2026-08-22** — `docs/plan/0007-localization.md`, seven steps. **D8 (app shell and record surfaces) shipped 2026-08-27** — `docs/plan/0008-app-shell-and-record-surfaces.md`, twelve steps. **D9 (platform extraction) shipped 2026-08-28** — `docs/plan/0009-platform-extraction.md`, seven steps — and **its window on ADR-0051 shut with it**. **D10 (grid and admin follow-ups) shipped 2026-08-29** — `docs/plan/0010-grid-and-admin-followups.md`, six steps — and **its window on ADR-0052 shut with it**. **ADRs 0001–0052 are closed**, and **ADR-0033 is superseded by 0051 and ADR-0049 by 0051** (delta supersessions: both keep every decision they made, and lose only where the code lives). **ADR-0031 is superseded by 0047, ADR-0032 by 0049 and ADR-0024 by 0050.** An ADR is accepted at the head of the step that builds it, so a step whose ADR is still `proposed` is gated and must not be started. **The planned rows were re-scoped 2026-08-22** (`docs/plan/README.md` §How D8–D13 were re-scoped): D8 app shell and record surfaces, D9 platform extraction, D10 grid and admin follow-ups, D11 the customer app, D12 impersonation, D13 the marketing site.

## Rules that always apply

- **Deliverables and the ADR window** (ADR-0025): an ADR may be amended in place only while the deliverable it belongs to is `in progress` in `docs/plan/README.md`. **ADRs 0001–0052 are frozen** (D1–D10 shipped) — diverging from one means writing a superseding ADR, never editing it. **No amendment window is open**: D10 shipped 2026-08-29 and the window on [ADR-0052](docs/adr/0052-grid-and-admin-followups.md) shut with it, Under ADR-0052, ADR-0039 and ADR-0048 moved to `superseded by` at `D10.1`, and ADR-0026 and ADR-0036 at `D10.5` — all deltas, so each parent stands for everything 0052 does not touch. Check `docs/plan/README.md` before assuming otherwise. ADRs 0024, 0026, 0031, 0032, 0033, 0034, 0036, 0039, 0040, 0048 and 0049 are `superseded by`: read their successors (0050, 0052, 0047, 0049→0051, 0051, 0043, 0052, 0052, 0044, 0052, 0051) — and for the six delta supersessions (0026, 0033, 0036, 0039, 0048, 0049) the parent still stands for everything its successor does not touch. **0026 and 0036 joined that list at `D10.5`**, because each decided the gate does not grow a fourth command and the bundle budget grows one; every caching and testing rule in them is untouched.
- **The lifecycle is ADR-0050** (superseding 0024): a superseding ADR **states the delta** and carries the parent's untouched sections by reference — whole restatement is permitted, never required. An ADR records decisions, not counts, enumerations or facts a compiler could check; those belong in tests and lint rules. Verification is the deterministic gate plus **one bounded review pass per step on the diff** — no refutation rounds, no zero-finding gate.
- **Task caching** (ADR-0026): a task whose result depends on anything outside the repo is never cached and declares its `env`. `pnpm test` includes the integration tier, so it is `cache: false` and runs `--concurrency=1`; `pnpm check` (lint + check-types + test:unit) is the cached fast loop.
- **The domain rules load with the files**: `.claude/rules/api.md` when you touch `apps/api` or the data packages, `.claude/rules/frontend.md` when you touch `apps/admin`, `packages/ui` or any of D9's six platform packages. They are the ADR non-negotiables condensed; if you are reading this without them and about to edit those paths, open the rule file first.

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
pnpm lint && pnpm check-types && pnpm test && pnpm size   # the gate: test includes integration and needs Postgres up; size builds the admin and weighs it
pnpm test:int --filter api     # integration tests only, against DATABASE_URL_TEST
pnpm test:e2e                  # Playwright over the dev stack (D10.4) — beside the gate, never in it
pnpm test:postman              # newman over docs/postman
```

## Repo map

- `apps/api` — Express 5 API (`src/core`, `src/modules/<feature>`, `src/routes/{public,user,admin}.router.ts`, `src/core/container.ts` composition root)
- `apps/admin` (Vite + React SPA, port 3001): `src/{app,pages,widgets,features,entities,shared}` per ADR-0049 (superseded by ADR-0051 for what the `shared/` slices are — doors over packages), resources under `entities/` + `features/<x>-manage/` + a thin `pages/<x>/`, machinery in `shared/{api,form,grid,resource,ui,notifications,i18n}`; `apps/web` (Next.js) — marketing only, built last (D13); the user-facing product is the planned `apps/customer` Vite SPA (D11)
- `packages/db` (Drizzle schema, migrations, seeds), `packages/contracts`, `packages/crypto`, `packages/logger`, `packages/config-*`, `packages/ui`
- **The platform packages, extracted at D9** (ADR-0051), which every SPA is built from and reaches only through its own `shared/` doors: `packages/api-client` (client, session, CSRF, URL⇄query, bulk fan-out), `packages/i18n` (the `createI18n` factory), `packages/resource` (`ResourceConfig` and its readers), `packages/grid` (the v2 grid), `packages/form` (the field vocabulary, the three record shells, the zod locale installer), `packages/app-services` (theme, `can()`, `route-meta`). Each app keeps its dictionary, its policy data and its config
- `docker/local` — compose for local dev; `docs/` — ADRs, plan, Postman; `scripts/` — repo-level tooling outside the workspaces (ADR-0002)

## Search

Use the Grep/Glob tools to search this repo; never `grep -r`, `find` or `rg` through Bash — they walk `node_modules` and `.turbo`, and `.claude/settings.json` denies them. Single-file reads (`cat`, `sed -n`) are fine.

## Workflow expectations

1. Before implementing: identify the ADRs involved; if a change conflicts with one, check its deliverable in `docs/plan/README.md`. In progress → amend in place, labelled. Shipped → stop and propose a superseding ADR instead of diverging (ADR-0050 rule 1, ADR-0025 rule 2).
2. Use the project skills — they encode the ADR checklists. API and data: `/api-conventions`, `/new-api-module`, `/add-endpoint`, `/db-schema-change`, `/postman-sync`. Admin app: `/frontend-conventions`, `/new-resource-ui`, `/ui-component`. Process (ADR-0050) — the loop is **scope → step → ship**: `/scope` (a deliverable into a one-page plan whose done-whens are commands and test names), `/step` (the next step: implement, gate green, one bounded diff review, commit), `/ship` (close-out and the ledger row); plus `/new-adr` and `/local-dev`. Machines are the gate; LLM review is one pass on a diff, never a refutation loop; uncertain mechanics get a spike in a worktree, not a debate.
3. Every change ends green on `pnpm lint && pnpm check-types && pnpm test && pnpm size` — **the fourth link since D10.5** (ADR-0052): `size` builds `apps/admin` and compares the gzipped output against the committed `apps/admin/size-budget.json`, and it is cached, so it costs nothing when the build has not changed. New endpoints get integration tests (ADR-0021) and Postman requests.
4. Keep docs in sync: new env var → ADR-0004 + `.env.example` + `turbo.json` `env`; new endpoint → the current plan's scope + Postman; new decision → ADR + index (with its `D<n>.<step>` in the _Implemented_ column).
5. Commit messages: conventional commits (`feat(api): …`, `chore(db): …`, `docs(adr): …`). Commit by explicit path when another session may share the tree; unattended runs work in a worktree on their own branch and open a PR.
6. Ask before: deleting migrations, changing the envelope/error shape, adding a runtime dependency to `@repo/contracts`, or introducing any auth library.

## Subagents

`.claude/agents/`: `adr-reviewer`, `security-reviewer` (both read-only), `module-builder`, `ui-builder`, `db-migrator`, `test-engineer`, `adr-author`, `gate-runner` (haiku; runs `pnpm check` or the gate, reports pass/fail only). There are **no orchestration workflows**: the former decide → verify → build pipeline and its multi-agent refutation gates were retired 2026-08-26 (ADR-0050 records why — seventeen verification rounds converging on prose instead of code). The loop is `/scope` → `/step` → `/ship`, driven from an interactive session; the deterministic gate is the verification, and one reviewer per diff is the review.
