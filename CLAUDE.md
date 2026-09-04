# machxi-starter — guidance for Claude

A blueprint monorepo (Turborepo + pnpm) for projects that need an API, an admin panel and a customer app, meant to be **cloned into a project and merged from afterwards** ([`docs/forking.md`](docs/forking.md)).

**Architecture is decided in `docs/adr/`**, whose index opens with a topic → record-in-force table. Read the record that governs what you are about to change. Build order lives in the deliverable plans under `docs/plan/`, from the ledger [`docs/plan/README.md`](docs/plan/README.md).

## Rules that always apply

- **Load the digest for your area before writing code**: [`docs/rules/`](docs/rules/) holds one per area — API and data, frontend and platform, process — generated, each line naming its record. The path-scoped files in `.claude/rules/` load the right one with the files you touch. The records are the source of truth; the digests are derived and never hand-edited.
- **The amendment window.** A record may be amended in place only while the deliverable it belongs to is in progress; anything else changes by supersession. Which window is open, which records are frozen and which supersession is a delta is stated in exactly one place — [the ledger's window section](docs/plan/README.md#the-window) — and linked, never restated.
- **A step whose record is still `proposed` is gated.** The record is accepted at the head of the step that builds it.
- **A fork supersedes; it never edits an inherited record.** An edit turns the next merge into a conflict and erases which decision was deliberately dropped ([`docs/forking.md`](docs/forking.md), [`docs/upstreaming.md`](docs/upstreaming.md)).

## Commands

```
pnpm i                         # Node 22, pnpm 10 (corepack enable)
cp .env.example .env
cp apps/admin/.env.example apps/admin/.env       # each SPA reads its own
cp apps/customer/.env.example apps/customer/.env
pnpm docker:up                 # Postgres 16 + Mailpit; first start creates both database roles
pnpm db:setup                  # migrate + seed the super admin from .env
pnpm db:seed -- --dev          # dev fixtures (staff and customer users)
pnpm dev --filter api          # http://localhost:4000
pnpm dev --filter admin        # http://localhost:3001 (needs the API up)
pnpm dev --filter customer     # http://localhost:3002 (needs the API up)

pnpm check                     # the fast inner loop: lint + check-types + test:unit + i18n:check, cached

# THE GATE — defined here, referenced by name everywhere else:
pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check

pnpm test:int --filter api     # integration tier alone, against DATABASE_URL_TEST
pnpm test:e2e                  # Playwright over the dev stack — beside the gate, never in it
pnpm test:postman              # newman over docs/postman
pnpm rules:digest              # regenerate docs/rules (pnpm docs:check audits .claude/**)
pnpm test:scripts              # the repo-level script tests
```

`pnpm test` includes the integration tier, so it needs Postgres up and runs serialised; `size` weighs each SPA's build against its own `size-budget.json`.

## Repo map

- `apps/api` — Express 5 API: `src/core`, `src/modules/<feature>`, `src/routes/{public,user,admin}.router.ts`, and `src/core/container.ts` as the composition root
- `apps/admin` — staff SPA (Vite + React, 3001) over `/admin`; `apps/customer` — user SPA (3002) over `/user`. Both are `src/{app,pages,widgets,features,entities,shared}`; a resource is an entity slice, a feature slice and a thin page, and every platform package is reached through a `shared/` door
- `packages/db` (Drizzle schema, migrations, seeds), `packages/contracts`, `packages/crypto`, `packages/logger`, `packages/config-*`, `packages/ui`
- The **platform packages** both SPAs are built from: `api-client`, `i18n`, `resource`, `grid`, `form`, `app-services`, `app-kit`. Each app keeps its dictionary, policy data, config, route tree and size budget
- `docker/` — local compose and the reference production compose; `docs/` — records, plans, rules, Postman; `scripts/` — repo-level tooling outside the workspaces; `turbo/generators` — the two scaffolds

## Search

Search with the Grep/Glob tools — including inside a single known file. Through Bash, `grep -r`, `find` and `rg` are denied outright (they walk `node_modules` and `.turbo`), and even a one-file `grep` is unapproved, so it stalls an unattended run; `cat` on a known path is fine.

## Workflow expectations

1. Before implementing: load your area's digest, then open the records it names for what you are changing. If the change conflicts with a record, check whether its deliverable is in progress — in progress means amend in place, labelled; shipped means propose a superseding record instead of diverging.
2. Use the skills — they encode the checklists. API and data: `/api-conventions`, `/new-api-module`, `/add-endpoint`, `/db-schema-change`, `/postman-sync`. SPAs: `/frontend-conventions`, `/new-resource-ui`, `/ui-component`. Process — the loop is **scope → step → ship** — `/scope`, `/step`, `/steps`, `/ship`, plus `/new-adr`, `/bootstrap` and `/local-dev`.
3. Every change ends green on the gate above. New endpoints get integration tests and Postman requests; a new decision gets a record.
4. Keep the derived documents in sync: a new env var means a record entry, `.env.example` and `turbo.json` `env`; a new endpoint means Postman; a new record means an index row and a topic-table row.
5. Conventional commits, by explicit path when another session may share the tree.
6. Ask before: deleting migrations, changing the envelope or error shape, adding a runtime dependency to `@repo/contracts`, or introducing any auth library.

## Subagents

`.claude/agents/`: `adr-reviewer` and `security-reviewer` (read-only), `module-builder`, `ui-builder`, `db-migrator`, `test-engineer`, `adr-author`, `code-reviewer`, `gate-runner`. There are **no orchestration workflows**: machines are the gate, review is one bounded pass over a diff.
