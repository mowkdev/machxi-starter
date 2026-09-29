# Documentation

| Path                                                           | Contents                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`adr/`](adr/README.md)                                        | Architecture Decision Records — the _why_ behind the repo structure. Start with the index: it lists every decision, its status, and the build step that implemented it.                                                                                                  |
| [`plan/`](plan/README.md)                                      | Deliverables — the staged units of work (ADR-0025), one plan file each. The ledger says which are in progress — one or more lanes whose records are disjoint (ADR-0079); a plan says how that deliverable is built, step by step, and why each step decided what it did. |
| [`postman/`](postman/README.md)                                | The Postman collection and environment — the manual/smoke tier of ADR-0021, and the API's living documentation until OpenAPI exists. Runs headless with `pnpm test:postman`.                                                                                             |
| [`../docker/`](../docker/README.md)                            | Container setups — local Postgres for dev and the integration tests (ADR-0007).                                                                                                                                                                                          |
| [`../.claude/`](../.claude/README.md)                          | Claude Code project setup: `CLAUDE.md` summary, subagents (`agents/`), slash-command skills (`skills/`), shared permissions.                                                                                                                                             |
| [`specs/`](specs/README.md)                                    | The behaviour specs — one per capability: what the API answers on the wire, and the SPA flows a step has named, each requirement with scenarios and the record and test behind it. Current truth, edited in place by the step that changes the behaviour (ADR-0068).     |
| [`rules/`](rules/)                                             | The current-rules digests — one per area, generated from the records by `pnpm rules:digest` and regenerated at ship. Each line names the record it comes from; a session loads the digest for its area rather than the whole chain.                                      |
| [`forking.md`](forking.md), [`upstreaming.md`](upstreaming.md) | How this repository becomes a project, and how a generic feature comes back (ADR-0065).                                                                                                                                                                                  |
| [`CHANGELOG.md`](CHANGELOG.md)                                 | One entry per shipped deliverable, with its `starter-D<n>` tag.                                                                                                                                                                                                          |
| [`reviews/`](reviews/)                                         | Dated whole-repository reviews — findings with ids, severities, evidence and the smallest fix, written to be cited from a step that closes them. Not a record: a review observes, a record decides.                                                                      |

## Where to look for what

- **"Why is it built this way?"** → the ADR. `docs/adr/README.md` indexes them all, and [ADR-0050](adr/0050-adr-lifecycle-and-verification.md) (superseding [ADR-0024](adr/0024-adr-lifecycle.md)) + [ADR-0025](adr/0025-deliverables.md) govern how they change.
- **"What does the API answer for X?"** → the capability's spec in [`specs/`](specs/README.md) — the requirement, its scenarios and the test that proves it; then the Postman collection, whose requests that turn on a decision name the ADR that made it.
- **"What happened while step X was built?"** → the deliverable's `.notes.md` beside its plan; the plan itself holds only what is executed (ADR-0068).
- **"How do I run it?"** → the root [`README.md`](../README.md) quick-start, or [`docker/README.md`](../docker/README.md) when Postgres is the problem.
- **"How do I add an endpoint / a module / a migration?"** → the skills in [`.claude/skills/`](../.claude/README.md); they encode the ADR checklists.
- **"How do I add a screen / a resource / a component to the admin panel?"** → the frontend half of the same set: `/frontend-conventions`, `/new-resource-ui`, `/ui-component`.
- **"What are we working on, and what is left?"** → the ledger [`plan/README.md`](plan/README.md), then the plan of each deliverable its window section lists as an open lane.

## Conventions

ADRs are the source of truth for decisions; the plans, the digests and the
Postman collection are derived from them. The specs are the source of truth for
behaviour, and each one names the test that keeps it true.

**Window, supersession and date history lives in exactly one place** — [the
ledger's window section](plan/README.md#the-window) ([ADR-0065](adr/0065-starter-lifecycle.md)
§5, the starter lifecycle, a delta on [ADR-0025](adr/0025-deliverables.md) for
where that state is written). Which deliverables may amend their records in
place — one entry per open lane, their records disjoint
([ADR-0079](adr/0079-parallel-lanes.md)) — which records are frozen, and which
supersession is a delta are all stated there and linked from everywhere else, including this file. When another
document disagrees with that section, that section is right and the other is
the defect.

An ADR is accepted at the head of the step that builds it, so a step whose
record is still `proposed` is gated and must not be started.
