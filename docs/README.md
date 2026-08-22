# Documentation

| Path                                  | Contents                                                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`adr/`](adr/README.md)               | Architecture Decision Records — the _why_ behind the repo structure. Start with the index: it lists every decision, its status, and the build step that implemented it.                                       |
| [`plan/`](plan/README.md)             | Deliverables — the staged units of work (ADR-0025), one plan file each. The ledger says which is in progress; a plan says how that deliverable is built, step by step, and why each step decided what it did. |
| [`postman/`](postman/README.md)       | The Postman collection and environment — the manual/smoke tier of ADR-0021, and the API's living documentation until OpenAPI exists. Runs headless with `pnpm test:postman`.                                  |
| [`../docker/`](../docker/README.md)   | Container setups — local Postgres for dev and the integration tests (ADR-0007).                                                                                                                               |
| [`../.claude/`](../.claude/README.md) | Claude Code project setup: `CLAUDE.md` summary, subagents (`agents/`), slash-command skills (`skills/`), shared permissions.                                                                                  |

## Where to look for what

- **"Why is it built this way?"** → the ADR. `docs/adr/README.md` indexes them all, and [ADR-0024](adr/0024-adr-lifecycle.md) + [ADR-0025](adr/0025-deliverables.md) govern how they change.
- **"What does the API answer for X?"** → the Postman collection; the requests that turn on a decision name the ADR that made it.
- **"How do I run it?"** → the root [`README.md`](../README.md) quick-start, or [`docker/README.md`](../docker/README.md) when Postgres is the problem.
- **"How do I add an endpoint / a module / a migration?"** → the skills in [`.claude/skills/`](../.claude/README.md); they encode the ADR checklists.
- **"How do I add a screen / a resource / a component to the admin panel?"** → the frontend half of the same set: `/frontend-conventions`, `/new-resource-ui`, `/ui-component`.
- **"What are we working on, and what is left?"** → the ledger [`plan/README.md`](plan/README.md), then the plan of the deliverable it says is in progress.

## Conventions

ADRs are the source of truth for decisions; the plans and the Postman collection
are derived from them.

The in-place amendment window is scoped to a deliverable ([ADR-0025](adr/0025-deliverables.md)
rule 2), not to a date. An ADR is amendable only while its deliverable is
`in progress` in the ledger; once that deliverable ships, code and ADR that
disagree are reconciled by a superseding ADR, never by editing the record. D1
shipped 2026-08-18, D2 2026-08-19, D3 2026-08-20, D4 2026-08-21, D5 2026-08-22
and D6 2026-08-22, so **ADRs 0001–0045 are closed** — including every frontend
decision the admin panel was built on, every grid decision the data-grid rebuild
made, D5's pair of supersessions, and D6's user-settings record. **D7 opened
2026-08-22**, so exactly one window is open and it holds one record —
[ADR-0046](adr/0046-interface-localization.md), **accepted 2026-08-22 at the
head of `D7.1`** and amendable in place until D7 ships. An ADR is accepted at
the head of the step that builds it, so a step whose ADR is still `proposed` is
gated and must not be started.
