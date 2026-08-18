# Documentation

| Path                                               | Contents                                                                                                                                                                                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`adr/`](adr/README.md)                            | Architecture Decision Records — the _why_ behind the repo structure. Start with the index: it lists every decision, its status, and the build step that implemented it.                                                                 |
| [`implementation-plan.md`](implementation-plan.md) | How the API was built, step by step: endpoint scope, the decisions each step had to make, and the hand-offs between them. The first deliverable is complete; the entries stay as the record of what was decided under pressure and why. |
| [`postman/`](postman/README.md)                    | The Postman collection and environment — the manual/smoke tier of ADR-0021, and the API's living documentation until OpenAPI exists. Runs headless with `pnpm test:postman`.                                                            |
| [`../docker/`](../docker/README.md)                | Container setups — local Postgres for dev and the integration tests (ADR-0007).                                                                                                                                                         |
| [`../.claude/`](../.claude/README.md)              | Claude Code project setup: `CLAUDE.md` summary, subagents (`agents/`), slash-command skills (`skills/`), shared permissions.                                                                                                            |

## Where to look for what

- **"Why is it built this way?"** → the ADR. `docs/adr/README.md` indexes all 24, and [ADR-0024](adr/0024-adr-lifecycle.md) governs how they change.
- **"What does the API answer for X?"** → the Postman collection; the requests that turn on a decision name the ADR that made it.
- **"How do I run it?"** → the root [`README.md`](../README.md) quick-start, or [`docker/README.md`](../docker/README.md) when Postgres is the problem.
- **"How do I add an endpoint / a module / a migration?"** → the skills in [`.claude/skills/`](../.claude/README.md); they encode the ADR checklists.

## Conventions

ADRs are the source of truth for decisions; the plan and the Postman collection
are derived from them. The first deliverable shipped on 2026-08-18, which closed
the window in which accepted ADRs could be amended in place: when code and an ADR
now disagree, write a superseding ADR rather than silently diverging.
