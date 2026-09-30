# machxi-starter — guidance for Claude

A blueprint monorepo (Turborepo + pnpm) for projects that need an API, an admin panel and a customer app, meant to be **cloned into a project and merged from afterwards** ([`docs/forking.md`](docs/forking.md)).

**Architecture is decided in `docs/adr/`**, whose index opens with a topic → record-in-force table. Read the record that governs what you are about to change. Build order is in the plans under `docs/plan/`, from the ledger [`docs/plan/README.md`](docs/plan/README.md).

## Rules that always apply

- **Load the digest for your area before writing code**: [`docs/rules/`](docs/rules/) holds one per area (API and data, frontend and platform, process), each line naming its record. The path-scoped files in `.claude/rules/` load the right one by path. The records are the source of truth; a digest is never hand-edited.
- **The amendment window.** A record is amended in place only while its deliverable is in progress; anything else changes by supersession. Which windows are open (one per lane, ADR-0079), which records are frozen and which supersession is a delta is stated in one place — [the ledger's window section](docs/plan/README.md#the-window) — linked, never restated.
- **A step whose record is still `proposed` is gated.** The record is accepted at the head of the step that builds it.
- **A fork supersedes; it never edits an inherited record.** An edit turns the next merge into a conflict and erases which decision was deliberately dropped ([`docs/forking.md`](docs/forking.md), [`docs/upstreaming.md`](docs/upstreaming.md)).

## Commands

Setup: `README.md` §Quick start. The two checks are defined here, referenced by name elsewhere:

```
pnpm check                   # the inner loop, cached: lint (carrying the script
                             # tests, docs:check and i18n:check), check-types, test:unit
pnpm dev --filter api        # 4000 · admin 3001 · customer 3002
pnpm test:int --filter api   # the integration tier alone, against DATABASE_URL_TEST
pnpm test:e2e                # Playwright over the dev stack — beside the gate, never in it
pnpm test:postman            # newman over docs/postman
pnpm rules:digest            # regenerate docs/rules

# THE STEP CHECK — pnpm check, the integration files the change reaches,
# size when an SPA is reached, format:check (ADR-0082, lanes on one machine):
pnpm step:check

# THE GATE — the whole tree: CI on every push, the machine once at ship:
pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check
```

`pnpm test` includes the integration tier, so it needs Postgres and runs serialised; `size` weighs each SPA's build against its `size-budget.json`. `test`, `test:int`, `size` and `test:e2e` share one lock across worktrees (`scripts/with-lock.mjs`). Never pass `--force`: a cached result is a proof.

## Repo map

- `apps/` — `api` (Express 5: `src/core`, `src/modules/<feature>`, `src/routes/{public,user,admin}.router.ts`, `src/core/container.ts` the composition root), `admin` (staff SPA over `/admin`) and `customer` (user SPA over `/user`); both SPAs are `src/{app,pages,widgets,features,entities,shared}` and reach each package through a door — a `shared/` slice, or `account`'s feature and entity slices (ADR-0077 §3)
- `packages/` — `db`, `contracts`, `crypto`, `logger`, `config-*`, `ui`, and the eight platform packages both SPAs are built from: `api-client`, `i18n`, `resource`, `grid`, `form`, `app-services`, `app-kit`, `account`
- `docker/` local and reference-production compose · `docs/` records, plans, specs, rules, Postman · `scripts/` repo-level tooling · `turbo/generators` the two scaffolds

## The running stack is the operator's

The operator keeps the dev stack running across sessions — `pnpm docker:up`, the three apps above, Mailpit on 8025. **Attach to it; never start, stop, kill or restart it.** Probe the port (`GET /health` on 4000) and use what answers; `.claude/launch.json`'s url-only entries attach the Browser pane the same way. A change that needs a restart (an `.env` edit, a port) is reported to the operator. `launch.json`'s `*:spawn` entries are for a machine where nothing runs. Measurements that need a clean rate-limit window (`test:e2e`, `test:postman` back to back) ask the operator for the restart.

## Search

Search with the Grep/Glob tools, even inside one known file. Through Bash, `grep -r`, `find` and `rg` are denied (they walk `node_modules` and `.turbo`) and a one-file `grep` is unapproved, so it stalls an unattended run; `cat` on a known path is fine.

## Workflow expectations

1. Before implementing: load your area's digest, then open the records it names for what you are changing. A change that conflicts with a record amends it in place, labelled, while its deliverable is in progress, and otherwise proposes a superseding record.
2. Use the skills — they encode the checklists. API and data: `/api-conventions`, `/new-api-module`, `/add-endpoint`, `/db-schema-change`, `/postman-sync`. SPAs: `/frontend-conventions`, `/new-resource-ui`, `/ui-component`. Process — the loop is **scope → step → ship** — `/scope`, `/step`, `/steps`, `/ship`, plus `/new-adr`, `/bootstrap` and `/local-dev`.
3. A step ends green on the step check, a lane on the gate. New endpoints get integration tests and Postman requests; a new decision gets a record.
4. Keep the derived documents in sync: a new env var means a record entry, `.env.example` and `turbo.json` `env`; a new endpoint means Postman; a new record means an index row and a topic-table row; a behaviour change means its `docs/specs/` file.
5. Conventional commits, by explicit path when another session may share the tree.
6. Ask before: deleting migrations, changing the envelope or error shape, adding a runtime dependency to `@repo/contracts`, or introducing any auth library.

## Subagents

The roster is `.claude/agents/` and `.claude/README.md` says what each is for — three read-only reviewers, the builders, `gate-runner`. There are **no orchestration workflows**: machines gate, review is one bounded pass over a diff.
