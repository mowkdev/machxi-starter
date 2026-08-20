# Deliverables

The ledger of staged work in this repository. A **deliverable** is the unit defined by [ADR-0025](../adr/0025-deliverables.md): it is what a plan file describes, what a step number is scoped to, and what opens and closes an [ADR-0024](../adr/0024-adr-lifecycle.md) amendment window.

Read this file first; open a plan only when you are working in it.

| #                            | Title                              | Status                 | Scope in one line                                                                                                                        |
| ---------------------------- | ---------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [D1](0001-api-foundation.md) | API foundation                     | **shipped 2026-08-18** | A running, testable API: config, logging, DB, migrations, seeds, both auth flows, staff/users admin, profile.                            |
| [D2](0002-api-hardening.md)  | API hardening and D3 prerequisites | **shipped 2026-08-19** | Close the gaps D1's review found, and make the decisions the frontend apps cannot start without.                                         |
| [D3](0003-admin-app.md)      | Admin panel (`apps/admin`)         | **shipped 2026-08-20** | The staff-facing SPA over the admin segment, plus its two prerequisites: `packages/ui` and `GET /auth/csrf`.                             |
| [D4](0004-data-grid-v2.md)   | Data grid v2 (`apps/admin`)        | **in progress**        | Selection and bulk actions, capability-driven toolbars, filter UX, viewport layout, edit surfaces in the URL, persisted column settings. |
| D5                           | Web app (`apps/web`)               | planned                | The Next.js user-facing app ADR-0022 configured. Opens when D4 ships.                                                                    |

## Rules

- **One deliverable is in progress at a time** (ADR-0025 rule 5).
- **Steps are written `D<n>.<step>`** — `D1.7`, `D2.3`. Inside a plan file they are numbered plainly; the prefix is how they are cited from the ADR index and from commits.
- **An ADR may be amended in place only while its deliverable is in progress** (ADR-0025 rule 2). D1, D2 and D3 have shipped, so ADRs 0001–0036 are closed: change any of them with a superseding ADR that carries the whole decision. ADRs 0037–0042 were written for D4 and carry the exception until D4 closes.
- **A deliverable closes on an executable acceptance checklist** (ADR-0025 rule 4), the ledger row moves to `shipped YYYY-MM-DD`, and the amendment window shuts. All three or it is not closed.

## Executing a step

`/plan-step D2.3` — the skill reads the step, reads the ADRs it names, implements, tests and reports. Every step below names the ADRs that govern it precisely so that it can be handed to an agent without further context.

## How D3 opened

D3 opened 2026-08-19, the day D2 shipped, and its scope changed on the way in: the old ledger row said "frontend apps (`web`, `admin`)", but the two apps share almost nothing beyond `@repo/ui` — different framework, different API segments, different session model — so D3 is the admin panel alone and `web` moves to D4. [ADR-0025](../adr/0025-deliverables.md) §Consequences expected the frontend apps to be one deliverable with two apps in it "unless and until this ADR says otherwise"; that ADR is now frozen and cannot say otherwise, so the divergence is acknowledged here instead — deliverable scoping is what this ledger exists to record, no numbered rule of ADR-0025 is broken, and the split is a ledger decision, not an edit to a frozen record. What blocked D3 resolved as follows:

- **The `packages/ui` decision is made.** [ADR-0031](../adr/0031-ui-design-system.md) makes `@repo/ui` the shadcn/ui design system on Tailwind v4; building it is `D3.1`.
- **The same-host constraint is addressed rather than accepted.** D3's reference deployment is subdomains (`admin.example.com` against `api.example.com`) — same-site but cross-host, exactly the shape ADR-0029 §Consequences (amended D2.5) says cannot bootstrap after a reload. [ADR-0030](../adr/0030-csrf-bootstrap-endpoint.md) adds the `GET /auth/csrf` endpoint ADR-0029 delegated, which is the one API change in the deliverable and lands early (`D3.2`), before any client code depends on it.

ADRs 0030–0036 were written `proposed` and **accepted 2026-08-19**, before any implementing step started, so every step of the plan was un-gated (ADR-0025 rule 3). All seven were amended in place by the steps that built them, and all seven closed with the deliverable.

## How D3 closed, and on what evidence

**D3 shipped 2026-08-20**, ten steps built, and the three parts of ADR-0025 rule 4 happened together: the checklist was accepted, this row moved, and the window on ADRs 0030–0036 shut.

The evidence is worth separating, because rule 4 asks for an executable checklist and only part of it was executed in the session that closed it. **Machine-verified**: `pnpm lint`, `pnpm check-types` and `pnpm format:check` clean with a clean tree afterwards; `pnpm test` green twice at `0 cached, 8 total`, so the API's integration tier really ran both times; `pnpm test:unit` returning `8 cached, 8 total` on its second run with `admin` among them, which is the ADR-0026 property the checklist exists to prove; and `pnpm test:postman` at 84 requests and 260 assertions, none failed. **Accepted by the operator**: items 4 and 5 — signing in and walking the three screens — and the reload half of item 6. That half needs a browser against a stack, and the machine that ran the rest had its ports and its dev database in use by other work, so a walk there would have been a walk of something else. Closing on the operator's acceptance of it is a judgement call, made deliberately and recorded here rather than folded into the word "shipped"; the automated tiers above are what the repository can re-run.

## How D4 opened

**D4 opened 2026-08-20**, the day D3 shipped, and its scope is what a review of D3.6–D3.8 found the grid still owed: two shipped layout defects and no viewport-height strategy, an always-visible filter row that inflates column widths, edit surfaces invisible to the URL, no row selection or toolbar, and none of the column ergonomics ADR-0035 deferred "until a need names it". `apps/admin` and `packages/ui` only — the one requirement that brushed the API, bulk delete, is answered client-side on purpose (ADR-0038).

Its six ADRs — [0037](../adr/0037-grid-viewport-layout.md)–[0042](../adr/0042-client-side-authorization.md) — were written 2026-08-20, while D3 was still in progress, and are `proposed`. **Writing is not opening and opening is not accepting**: their amendment window opens now, and each is accepted before its own implementing step starts, which is what the plan's Gate line means. That is a change from how D3 opened, where all seven were accepted the same day; per-step acceptance is the stricter reading of ADR-0025 rule 3 and costs one edit per step.

[ADR-0042](../adr/0042-client-side-authorization.md) is the one D4 inherited rather than scoped: `D3.8` found a `manager` being offered five writes `/admin/users` refuses, `D3.10` wrote the decision, and `D4.3` builds it beside ADR-0038's capabilities because the two are halves of one question.
