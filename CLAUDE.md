# machxi-starter — guidance for Claude

A blueprint monorepo (Turborepo + pnpm) for projects that need an API, an admin panel and a customer app, meant to be **cloned into a project and merged from afterwards** ([`docs/forking.md`](docs/forking.md)).

**Architecture is decided in `docs/adr/`**, whose index opens with a topic → record-in-force table. Read the record that governs what you are about to change. Build order lives in the deliverable plans under `docs/plan/`, from the ledger [`docs/plan/README.md`](docs/plan/README.md).

## Rules that always apply

- **Load the digest for your area before writing code**: [`docs/rules/`](docs/rules/) holds one per area — API and data, frontend and platform, process — generated, each line naming its record. The path-scoped files in `.claude/rules/` load the right one with the files you touch. The records are the source of truth; the digests are derived and never hand-edited.
- **The amendment window.** A record may be amended in place only while the deliverable it belongs to is in progress; anything else changes by supersession. Which window is open, which records are frozen and which supersession is a delta is stated in exactly one place — [the ledger's window section](docs/plan/README.md#the-window) — and linked, never restated.
- **A step whose record is still `proposed` is gated.** The record is accepted at the head of the step that builds it.
- **A fork supersedes; it never edits an inherited record.** An edit turns the next merge into a conflict and erases which decision was deliberately dropped ([`docs/forking.md`](docs/forking.md), [`docs/upstreaming.md`](docs/upstreaming.md)).

## Commands

Setup is `README.md` §Quick start; these are the ones a session reaches for:

```
pnpm check                   # the inner loop, cached: lint (carrying the script
                             # tests, docs:check and i18n:check), check-types, test:unit
pnpm dev --filter api        # 4000 · admin 3001 · customer 3002
pnpm test:int --filter api   # the integration tier alone, against DATABASE_URL_TEST
pnpm test:e2e                # Playwright over the dev stack — beside the gate, never in it
pnpm test:postman            # newman over docs/postman
pnpm rules:digest            # regenerate docs/rules

# THE GATE — defined here, referenced by name everywhere else:
pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check
```

`pnpm test` includes the integration tier, so it needs Postgres up and runs serialised; `size` weighs each SPA's build against its `size-budget.json`.

## Repo map

- `apps/` — `api` (Express 5: `src/core`, `src/modules/<feature>`, `src/routes/{public,user,admin}.router.ts`, `src/core/container.ts` the composition root), `admin` (staff SPA over `/admin`) and `customer` (user SPA over `/user`); both SPAs are `src/{app,pages,widgets,features,entities,shared}` and reach every package through a door — a `shared/` slice, or for the feature package `account` the feature and entity slices that front it (ADR-0077 §3)
- `packages/` — `db`, `contracts`, `crypto`, `logger`, `config-*`, `ui`, and the eight platform packages both SPAs are built from: `api-client`, `i18n`, `resource`, `grid`, `form`, `app-services`, `app-kit`, `account`
- `docker/` local and reference-production compose · `docs/` records, plans, specs, rules, Postman · `scripts/` repo-level tooling · `turbo/generators` the two scaffolds

## The running stack is the operator's

The operator keeps the whole dev stack running — `pnpm docker:up`, the API on 4000, the admin app on 3001, the customer app on 3002, Mailpit on 8025 — and it stays up across sessions. **Attach to it; never start, stop, kill or restart it.** Probe the port (`GET /health` on 4000) and use what answers; `.claude/launch.json`'s url-only entries attach the Browser pane the same way. A change that needs a restart — an `.env` edit, a port change — is reported to the operator, who performs it. The `*:spawn` entries in `launch.json` exist for a machine where nothing is running, not for replacing what is. Measurements that need a clean rate-limit window (`test:e2e`, `test:postman` back to back) ask the operator for the restart rather than taking it.

## Search

Search with the Grep/Glob tools — including inside a single known file. Through Bash, `grep -r`, `find` and `rg` are denied outright (they walk `node_modules` and `.turbo`), and even a one-file `grep` is unapproved, so it stalls an unattended run; `cat` on a known path is fine.

## Workflow expectations

1. Before implementing: load your area's digest, then open the records it names for what you are changing. If the change conflicts with a record, check whether its deliverable is in progress — in progress means amend in place, labelled; shipped means propose a superseding record instead of diverging.
2. Use the skills — they encode the checklists. API and data: `/api-conventions`, `/new-api-module`, `/add-endpoint`, `/db-schema-change`, `/postman-sync`. SPAs: `/frontend-conventions`, `/new-resource-ui`, `/ui-component`. Process — the loop is **scope → step → ship** — `/scope`, `/step`, `/steps`, `/ship`, plus `/new-adr`, `/bootstrap` and `/local-dev`.
3. Every change ends green on the gate above. New endpoints get integration tests and Postman requests; a new decision gets a record.
4. Keep the derived documents in sync: a new env var means a record entry, `.env.example` and `turbo.json` `env`; a new endpoint means Postman; a new record means an index row and a topic-table row; a behaviour change means its `docs/specs/` file.
5. Conventional commits, by explicit path when another session may share the tree.
6. Ask before: deleting migrations, changing the envelope or error shape, adding a runtime dependency to `@repo/contracts`, or introducing any auth library.

## Subagents

The roster is `.claude/agents/`, one file each, and `.claude/README.md` says what each is for — three read-only reviewers, the builders, and `gate-runner`. There are **no orchestration workflows**: machines are the gate, review is one bounded pass over a diff.
