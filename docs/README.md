# Documentation

| Path                                  | Contents                                                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`adr/`](adr/README.md)               | Architecture Decision Records — the _why_ behind the repo structure. Start with the index: it lists every decision, its status, and the build step that implemented it.                                       |
| [`plan/`](plan/README.md)             | Deliverables — the staged units of work (ADR-0025), one plan file each. The ledger says which is in progress; a plan says how that deliverable is built, step by step, and why each step decided what it did. |
| [`postman/`](postman/README.md)       | The Postman collection and environment — the manual/smoke tier of ADR-0021, and the API's living documentation until OpenAPI exists. Runs headless with `pnpm test:postman`.                                  |
| [`../docker/`](../docker/README.md)   | Container setups — local Postgres for dev and the integration tests (ADR-0007).                                                                                                                               |
| [`../.claude/`](../.claude/README.md) | Claude Code project setup: `CLAUDE.md` summary, subagents (`agents/`), slash-command skills (`skills/`), shared permissions.                                                                                  |

## Where to look for what

- **"Why is it built this way?"** → the ADR. `docs/adr/README.md` indexes all 29, and [ADR-0024](adr/0024-adr-lifecycle.md) + [ADR-0025](adr/0025-deliverables.md) govern how they change.
- **"What does the API answer for X?"** → the Postman collection; the requests that turn on a decision name the ADR that made it.
- **"How do I run it?"** → the root [`README.md`](../README.md) quick-start, or [`docker/README.md`](../docker/README.md) when Postgres is the problem.
- **"How do I add an endpoint / a module / a migration?"** → the skills in [`.claude/skills/`](../.claude/README.md); they encode the ADR checklists.
- **"What are we working on, and what is left?"** → the ledger [`plan/README.md`](plan/README.md), then the plan of the deliverable it says is in progress.

## Conventions

ADRs are the source of truth for decisions; the plans and the Postman collection
are derived from them.

The in-place amendment window is scoped to a deliverable ([ADR-0025](adr/0025-deliverables.md)
rule 2), not to a date. An ADR is amendable only while its deliverable is
`in progress` in the ledger; once that deliverable ships, code and ADR that
disagree are reconciled by a superseding ADR, never by editing the record. D1
shipped 2026-08-18, so ADRs 0001–0024 are closed; D2 is in progress, so ADRs
0025–0029 are not.
