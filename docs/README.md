# Documentation

| Path                                  | Contents                                                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`adr/`](adr/README.md)               | Architecture Decision Records — the _why_ behind the repo structure. Start with the index: it lists every decision, its status, and the build step that implemented it.                                       |
| [`plan/`](plan/README.md)             | Deliverables — the staged units of work (ADR-0025), one plan file each. The ledger says which is in progress; a plan says how that deliverable is built, step by step, and why each step decided what it did. |
| [`postman/`](postman/README.md)       | The Postman collection and environment — the manual/smoke tier of ADR-0021, and the API's living documentation until OpenAPI exists. Runs headless with `pnpm test:postman`.                                  |
| [`../docker/`](../docker/README.md)   | Container setups — local Postgres for dev and the integration tests (ADR-0007).                                                                                                                               |
| [`../.claude/`](../.claude/README.md) | Claude Code project setup: `CLAUDE.md` summary, subagents (`agents/`), slash-command skills (`skills/`), shared permissions.                                                                                  |

## Where to look for what

- **"Why is it built this way?"** → the ADR. `docs/adr/README.md` indexes them all, and [ADR-0050](adr/0050-adr-lifecycle-and-verification.md) (superseding [ADR-0024](adr/0024-adr-lifecycle.md)) + [ADR-0025](adr/0025-deliverables.md) govern how they change.
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
shipped 2026-08-18, D2 2026-08-19, D3 2026-08-20, D4 2026-08-21, D5 2026-08-22,
D6 2026-08-22, D7 2026-08-22, D8 2026-08-27 and D9 2026-08-28, so **ADRs
0001–0051 are closed** — including every frontend decision the admin panel was
built on, every grid decision the data-grid rebuild made, D5's pair of
supersessions, D6's user-settings record, D7's localization one, D8's four and
D9's platform extraction. D10 shipped 2026-08-29 and the window on
[0052](adr/0052-grid-and-admin-followups.md) shut with it.
**ADRs 0001–0056 are closed and no window is open** — **the D12 window shut
when D12 shipped 2026-09-01**; it covered [0055](adr/0055-customer-app.md) — `accepted` at `D12.1`'s head,
where [0022](adr/0022-frontend-apps.md) took the roster delta — and, since
2026-09-01, [0056](adr/0056-per-population-csrf-cookie.md) — `proposed`,
accepted at `D12.12`'s head, where
[0029](adr/0029-browser-token-transport.md) takes a one-name delta: the CSRF
cookie becomes per-population. D11 shipped
2026-08-31 and its window on [0053](adr/0053-account-area.md) and
[0054](adr/0054-design-language-instrument.md) shut with it, both `accepted`
in the window (0054 at `D11.1`'s head, 0053 at `D11.6`'s), each flipping its
parents as it was accepted. Under ADR-0052 four parents moved to
`superseded by`, all deltas — [0039](adr/0039-grid-filter-ux.md) and
[0048](adr/0048-app-shell-and-record-surfaces.md) at `D10.1`, and
[0026](adr/0026-task-graph-caching-and-serialisation.md) and
[0036](adr/0036-admin-testing-strategy.md) at `D10.5`, when the gate grew the
fourth link each of them had decided it would not grow.
[0051](adr/0051-platform-extraction.md) delta-supersedes
[0033](adr/0033-browser-api-client-and-session.md) and
[0049](adr/0049-admin-app-architecture.md), which keep every decision they made
and lose only where the code lives.
**[0031](adr/0031-ui-design-system.md) is superseded by
[0047](adr/0047-ui-package-scope.md),
[0032](adr/0032-admin-app-architecture.md) by
[0049](adr/0049-admin-app-architecture.md) and
[0024](adr/0024-adr-lifecycle.md) by
[0050](adr/0050-adr-lifecycle-and-verification.md)**. An ADR
is accepted at the head of the step that builds it, so a step whose ADR is still
`proposed` is gated and must not be started.
