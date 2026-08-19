# Deliverables

The ledger of staged work in this repository. A **deliverable** is the unit defined by [ADR-0025](../adr/0025-deliverables.md): it is what a plan file describes, what a step number is scoped to, and what opens and closes an [ADR-0024](../adr/0024-adr-lifecycle.md) amendment window.

Read this file first; open a plan only when you are working in it.

| #                            | Title                              | Status                 | Scope in one line                                                                                             |
| ---------------------------- | ---------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| [D1](0001-api-foundation.md) | API foundation                     | **shipped 2026-08-18** | A running, testable API: config, logging, DB, migrations, seeds, both auth flows, staff/users admin, profile. |
| [D2](0002-api-hardening.md)  | API hardening and D3 prerequisites | **shipped 2026-08-19** | Close the gaps D1's review found, and make the decisions the frontend apps cannot start without.              |
| [D3](0003-admin-app.md)      | Admin panel (`apps/admin`)         | **in progress**        | The staff-facing SPA over the admin segment, plus its two prerequisites: `packages/ui` and `GET /auth/csrf`.  |
| D4                           | Web app (`apps/web`)               | planned                | The Next.js user-facing app ADR-0022 configured. Not scheduled until D3 ships.                                |

## Rules

- **One deliverable is in progress at a time** (ADR-0025 rule 5).
- **Steps are written `D<n>.<step>`** — `D1.7`, `D2.3`. Inside a plan file they are numbered plainly; the prefix is how they are cited from the ADR index and from commits.
- **An ADR may be amended in place only while its deliverable is in progress** (ADR-0025 rule 2). D1 and D2 have both shipped, so ADRs 0001–0029 are closed: change any of them with a superseding ADR that carries the whole decision. ADRs 0030–0036 were written for D3 and carry the exception until D3 closes.
- **A deliverable closes on an executable acceptance checklist** (ADR-0025 rule 4), the ledger row moves to `shipped YYYY-MM-DD`, and the amendment window shuts. All three or it is not closed.

## Executing a step

`/plan-step D2.3` — the skill reads the step, reads the ADRs it names, implements, tests and reports. Every step below names the ADRs that govern it precisely so that it can be handed to an agent without further context.

## How D3 opened

D3 opened 2026-08-19, the day D2 shipped, and its scope changed on the way in: the old ledger row said "frontend apps (`web`, `admin`)", but the two apps share almost nothing beyond `@repo/ui` — different framework, different API segments, different session model — so D3 is the admin panel alone and `web` moves to D4. What blocked D3 resolved as follows:

- **The `packages/ui` decision is drafted.** [ADR-0031](../adr/0031-ui-design-system.md) (`proposed`) makes `@repo/ui` the shadcn/ui design system on Tailwind v4; building it is `D3.1`.
- **The same-host constraint is addressed rather than accepted.** D3's reference deployment is subdomains (`admin.example.com` against `api.example.com`) — same-site but cross-host, exactly the shape ADR-0029 §Consequences (amended D2.6) says cannot bootstrap after a reload. [ADR-0030](../adr/0030-csrf-bootstrap-endpoint.md) (`proposed`) adds the `GET /auth/csrf` endpoint ADR-0029 delegated, which is the one API change in the deliverable and lands early (`D3.2`), before any client code depends on it.

ADRs 0030–0036 are `proposed`: agreed in design, awaiting acceptance, each gating its implementing step (ADR-0025 rule 3).
