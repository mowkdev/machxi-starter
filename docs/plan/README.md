# Deliverables

The ledger of staged work in this repository. A **deliverable** is the unit defined by [ADR-0025](../adr/0025-deliverables.md): it is what a plan file describes, what a step number is scoped to, and what opens and closes an [ADR-0024](../adr/0024-adr-lifecycle.md) amendment window.

Read this file first; open a plan only when you are working in it.

| #                            | Title                              | Status                 | Scope in one line                                                                                             |
| ---------------------------- | ---------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| [D1](0001-api-foundation.md) | API foundation                     | **shipped 2026-08-18** | A running, testable API: config, logging, DB, migrations, seeds, both auth flows, staff/users admin, profile. |
| [D2](0002-api-hardening.md)  | API hardening and D3 prerequisites | **in progress**        | Close the gaps D1's review found, and make the decisions the frontend apps cannot start without.              |
| D3                           | Frontend apps (`web`, `admin`)     | planned                | Build the two apps ADR-0022 configured. Blocked — see below.                                                  |

## Rules

- **One deliverable is in progress at a time** (ADR-0025 rule 5).
- **Steps are written `D<n>.<step>`** — `D1.7`, `D2.3`. Inside a plan file they are numbered plainly; the prefix is how they are cited from the ADR index and from commits.
- **An ADR may be amended in place only while its deliverable is in progress** (ADR-0025 rule 2). D1's ADRs are closed: change them with a superseding ADR that carries the whole decision. ADRs written for D2 carry the exception until D2 closes.
- **A deliverable closes on an executable acceptance checklist** (ADR-0025 rule 4), the ledger row moves to `shipped YYYY-MM-DD`, and the amendment window shuts. All three or it is not closed.

## Executing a step

`/plan-step D2.3` — the skill reads the step, reads the ADRs it names, implements, tests and reports. Every step below names the ADRs that govern it precisely so that it can be handed to an agent without further context.

## What blocks D3

D3 is not scheduled because of one open decision and one dependency:

- **There is no ADR for `packages/ui`.** It is still Turborepo template scaffolding (`counter-button`, `link`), both apps already depend on it, and no decision covers styling, component conventions or whether it survives at all. This is a product and design decision rather than an engineering one, so no ADR is drafted for it here; it is listed under _Planned_ in the [ADR index](../adr/README.md) and is D3's first step.
- **D2.5 must land first.** [ADR-0029](../adr/0029-browser-token-transport.md) is `accepted` as of 2026-08-18, so the decision is made — but the `admin` app cannot be built against a contract that has not shipped, and it changes `apps/api` and `packages/contracts` rather than only the frontend. This is sequencing, not a blocker on a decision.
