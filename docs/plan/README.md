# Deliverables

The ledger of staged work in this repository. A **deliverable** is the unit defined by [ADR-0025](../adr/0025-deliverables.md): it is what a plan file describes, what a step number is scoped to, and what opens and closes an [ADR-0024](../adr/0024-adr-lifecycle.md) amendment window.

Read this file first; open a plan only when you are working in it.

| #                                  | Title                                | Status                 | Scope in one line                                                                                                                                   |
| ---------------------------------- | ------------------------------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [D1](0001-api-foundation.md)       | API foundation                       | **shipped 2026-08-18** | A running, testable API: config, logging, DB, migrations, seeds, both auth flows, staff/users admin, profile.                                       |
| [D2](0002-api-hardening.md)        | API hardening and D3 prerequisites   | **shipped 2026-08-19** | Close the gaps D1's review found, and make the decisions the frontend apps cannot start without.                                                    |
| [D3](0003-admin-app.md)            | Admin panel (`apps/admin`)           | **shipped 2026-08-20** | The staff-facing SPA over the admin segment, plus its two prerequisites: `packages/ui` and `GET /auth/csrf`.                                        |
| [D4](0004-data-grid-v2.md)         | Data grid v2 (`apps/admin`)          | **shipped 2026-08-21** | Selection and bulk actions, capability-driven toolbars, filter UX, viewport layout, edit surfaces in the URL, persisted column settings.            |
| [D5](0005-grid-url-readability.md) | Grid URL readability                 | **shipped 2026-08-22** | The two grid screens' address bar: list state in the API's own query language, and record routes that carry only the record.                        |
| [D6](0006-user-settings.md)        | User settings                        | planned                | Server-persisted per-account settings — theme, locale, per-grid preferences behind ADR-0041's adapter seam — on both segments. Opens when D5 ships. |
| [D7](0007-localization.md)         | Interface localization               | planned                | Every operator-facing string into a typed dictionary; the strategy designed for both SPAs and the shared packages, locale persisted via D6.         |
| [D8](0008-customer-app.md)         | Customer app and platform extraction | planned                | The shared machinery leaves `apps/admin/src/shared` for packages; `apps/customer` (Vite SPA over `/user`) is its first consumer — self-service v1.  |
| [D9](0009-impersonation.md)        | Customer impersonation               | planned                | Staff open the customer app as a chosen customer: minted `user` session, audit on every request, banner and exit, credential operations refused.    |
| D10                                | Marketing site (`apps/web`)          | planned                | The Next.js app, re-scoped from "user-facing" to marketing only — the operator's call, recorded in §How D6–D10 were scoped. Built last.             |

## Rules

- **One deliverable is in progress at a time** (ADR-0025 rule 5).
- **Steps are written `D<n>.<step>`** — `D1.7`, `D2.3`. Inside a plan file they are numbered plainly; the prefix is how they are cited from the ADR index and from commits.
- **An ADR may be amended in place only while its deliverable is in progress** (ADR-0025 rule 2). D1–D5 have shipped, so **ADRs 0001–0044 are closed**: change any of them with a superseding ADR that carries the whole decision. **No amendment window is open** — the next one opens with D6 and covers only the ADRs written for it.
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

## How D4 closed, and on what evidence

**D4 shipped 2026-08-21**, seven steps built, and ADR-0025 rule 4's three parts happened together: the checklist was run, this row moved, and the window on ADRs 0037–0042 shut.

The part worth recording is that **the checklist failed before it passed**, which is the first time that has happened here and the reason rule 4 asks for an executable one. At the last item of the last step, the walk found that `q` could not be cleared at all: `retainSearchParams(true)` — `D4.2`'s middleware — rebuilds a navigation's search as `{ ...search, ...next }`, so a param dropped by _omitting its key_ comes straight back, and `q` is the only list param removed that way. Emptying the search box left the term applied; ADR-0039's "Clear all clears filters and `q`" was false in writing. Every suite had missed it for one structural reason: the pure functions were correct, and the tests asserted _setting_ a term rather than clearing one, so the defect lived entirely in the seam between two right things. Fixed by naming the four params that survive omission, isolated by reverting to confirm both new tests fail without it, and amended into ADR-0040 while its window was still open.

The evidence is separated the way `D3.10` separated it, because rule 4 is about what a person can re-run. **Machine-verified:** `pnpm lint`, `pnpm check-types` and `pnpm format:check` clean; `pnpm test` green at `0 cached, 8 total` — 433 API integration tests unchanged across the entire deliverable, which is the sharpest evidence that D4 touched no API surface, plus 412 admin and 12 `@repo/ui`; `pnpm test:unit` twice at `8 cached, 8 total`, the ADR-0026 property that item exists to prove; and `pnpm test:postman` at 84 requests and 260 assertions, none failed — the same numbers D3 closed on, which is what "green, untouched" means. **Walked in a browser** across `D4.1`, `D4.6` and `D4.7`: the height budget and its one scroll container, selection surviving a page change, a bulk delete reporting "2 deleted, 1 refused" with the refusal named per item, all four filter kinds through their dialogs, hot filters agreeing with those dialogs both ways, a foreign deep-linked filter shown and removable, both record shells from cold URLs, and column width, order and visibility surviving a reload per grid.

**Accepted by the operator rather than machine-verified**, named individually rather than folded into the word "shipped": a genuinely fresh clone; how the new toolbar, filter bar and Columns menu wrap below roughly 900px; the sidebar's 200 ms reflow and overlay dismissal; and ADR-0042's narrowing on a live `manager` session. The middle two are not laziness but a tool limit measured at the time — the automated tab reports a fixed `innerWidth` however its window is resized, and `requestAnimationFrame` never ticks in it, so transitions and exit animations cannot complete. `D4.1` walked the equivalent shell geometry when the harness still could; what is unseen is the chrome `D4.3`–`D4.5` added inside it. That limit nearly produced a false finding at `D4.6`, where a dialog at `data-state="closed"` and still painted reads exactly like a bug until you notice its exit animation is running at zero progress.

## How D4 opened

**D4 opened 2026-08-20**, the day D3 shipped, and its scope is what a review of D3.6–D3.8 found the grid still owed: two shipped layout defects and no viewport-height strategy, an always-visible filter row that inflates column widths, edit surfaces invisible to the URL, no row selection or toolbar, and none of the column ergonomics ADR-0035 deferred "until a need names it". `apps/admin` and `packages/ui` only — the one requirement that brushed the API, bulk delete, is answered client-side on purpose (ADR-0038).

Its six ADRs — [0037](../adr/0037-grid-viewport-layout.md)–[0042](../adr/0042-client-side-authorization.md) — were written 2026-08-20, while D3 was still in progress, and were `proposed` when it opened. **Writing is not opening and opening is not accepting**: the window opened with the deliverable, and each ADR was accepted before its own implementing step started, which is what the plan's Gate line meant. That was a change from how D3 opened, where all seven were accepted the same day; per-step acceptance is the stricter reading of ADR-0025 rule 3 and cost one edit per step. All six were accepted that way and all six closed with the deliverable.

[ADR-0042](../adr/0042-client-side-authorization.md) is the one D4 inherited rather than scoped: `D3.8` found a `manager` being offered five writes `/admin/users` refuses, `D3.10` wrote the decision, and `D4.3` builds it beside ADR-0038's capabilities because the two are halves of one question.

## How D5 closed, and on what evidence

**D5 shipped 2026-08-22**, five steps built, and ADR-0025 rule 4's three parts happened together: the checklist was run, this row moved, and the window on ADRs 0043–0044 shut.

Two things about how it was verified are worth more than the numbers.

**The checklist's fourth item had never been run by anything, and it is the one the deliverable exists for.** Copy a grid's query string onto `/api/v1/admin/staff` and get the page the grid is showing. Run for the first time here: `?limit=50&sort=-lastName&filter[status]=active` answered `200` with `total: 7`, `sort` and `filters` echoed as the operator set them, and `qa-staff-1787068789671@machxi.local` first — while the same string in the address bar showed **1–7 of 7** with that same row at the top. One string, two ends, same page. Everything else in this deliverable is machinery; this is the property.

**A green suite is not a running app, and `D5.2` proved it the embarrassing way.** The operator reported still seeing JSON URLs after that step reported done, and they were right: its own isolation check restored `router.tsx` with `mv` from a backup, which put back an **older mtime** than the stripped version Vite had already transformed, so the dev server kept serving code the repository no longer contained. Every suite was green against a file the browser was not being given. `touch` was the whole fix, and the lesson is recorded rather than tidied away: restore by writing, never by moving, and check what the dev server serves rather than what the tree holds.

The evidence is separated the way D3 and D4 separated it.

**Machine-verified, and re-runnable by anyone:** `pnpm lint`, `pnpm check-types` and `pnpm format:check` clean. `pnpm test` green at `0 cached, 8 total` — admin 432, `@repo/contracts` 152, and **API integration 434 with the non-integration tier at 446**, which is the sharpest evidence that D5 touched no API surface: the only integration test it added is the one proving Express reads a literal bracket. `pnpm test:unit` twice, the second at **`8 cached, 8 total`, FULL TURBO** — the ADR-0026 property that item exists to prove. `pnpm test:postman` at **84 requests, 260 assertions, none failed** — identical to the numbers D3.10 and D4.7 closed on, which is what item 6's "green _and untouched_" actually claims.

**Walked in Chrome against the dev stack:** a sort and a header filter writing `?sort=email&filter[email][like]=%25ada%25` — literal brackets in a real address bar, with the LIKE pattern's `%` still encoded beside them; Clear all dropping the filter and leaving the sort; a record opened from a filtered page landing on `/staff/<id>` with nothing after it and the grid behind it still on that page; `history.state` carrying the snapshot, read directly; a **real `location.reload()` restoring both the record surface and the grid behind it**, which is the one claim jsdom cannot make; a cold record link rendering the bare list and closing to it; and item 4 above.

**Accepted by the operator rather than machine-verified**, named individually rather than folded into the word "shipped":

- **Item 1's fresh clone.** The stack these steps ran against is an existing one, with a dev database that has been walked through four deliverables.
- **Item 5's third edit surface.** No resource declares `page`, and flipping the config in a test needs module mocking, which ADR-0036 forbids. The URL claims are surface-independent by construction and the shell has its own suite; **the config path into it is untested, unchanged from D4**, which recorded the same gap twice.
- **The users record walk in a browser.** Covered in the MSW tier at `D5.3`, and walked for `staff` only.

One finding that belongs to the repository rather than to this deliverable: `pnpm check` — the parallel loop — failed on a loaded machine with individual tests reporting 274s, while the gate (`turbo run test --concurrency=1`) was green. The heaviest test now carries a measured 30s timeout. This is the first time the difference between those two commands has mattered, and it will matter again as the admin suite grows.

## How D5 opened

**D5 opened 2026-08-21**, the day D4 shipped, and it is an insertion rather than the next row down: the planned chain ran settings → localization → extraction, and this deliverable goes in front of it, so what was D5–D9 is now D6–D10. Renumbering four planned files is the cost of keeping the table readable in build order, and it is cheap precisely because none of them has steps yet — a plan file without steps is a scope document, and moving one costs its own cross-references and nothing else. Like the D3 split and the `apps/web` re-scoping below, **the insertion is a ledger decision, not an edit to a frozen record**; no numbered rule of ADR-0025 is touched by it.

Its scope is what D4 built and never read out loud. D4 put three things in the URL — list state, record identity, and an applied-filters bar that renders from the URL and from nothing else — and both defects below follow from decisions rather than from mistakes, which is why each needs a superseding ADR and not a fix:

- **The list URL is TanStack Router's JSON encoding of the parsed shape**, because [ADR-0034](../adr/0034-server-state-and-notifications.md) §61 decided that the browser's serialization and the API's wire form "need not match". `D3.8`'s `stripSearchParams` made the _empty_ case clean and stopped there, so `/staff` is bare and one applied filter is forty percent-encoded characters. The API's own language — ADR-0014's, defined once and already implemented in `shared/api/list-params.ts` for every request the panel sends — spells the same state `?sort=-email&filter[status]=active`.
- **Record URLs carry the sender's grid**, because [ADR-0040](../adr/0040-record-routes-and-edit-surfaces.md) answered "closing a record returns you to the page you opened it from" with `retainSearchParams` on the list parent. The requirement is right; the mechanism is what makes "look at this account" a link to somebody's offset, page size, sort and filters.

**Ordered ahead of settings deliberately.** Both halves are contracts that later work builds on rather than features beside it: D8 extracts `shared/grid` and `shared/api` into packages and gives them a second consumer, and a serialization changed _after_ that is changed in two apps and a package instead of in one app. That is the argument this ledger already makes for putting localization before the customer app — pay the sweep once — applied one deliverable earlier. It is also the smallest deliverable in the table, and it leaves ADR-0041's adapter seam untouched, so D6's own opening argument survives the insertion intact.

Its two ADRs — [0043](../adr/0043-readable-list-search-params.md) and [0044](../adr/0044-record-routes-without-list-state.md) — were written 2026-08-21 and are `proposed`. **Both supersede rather than amend**, which makes this the first deliverable here whose content is entirely supersession: their parents shipped with D3 and D4 and are frozen, so ADR-0024 rule 1 applies and each successor carries the whole of its parent rather than the delta. Per-step acceptance continues from D4 — `D5.1` and `D5.2` are gated on ADR-0043, `D5.3` on ADR-0044.

## How D6–D10 were scoped

Scoped 2026-08-20, while D4 was in progress — **scoping is not opening**: each of them opens when the one before it ships, one at a time as ever, and each plan file above carries scope, rationale and explicitly-labelled assumptions rather than steps. Steps are written when a deliverable opens, and every assumption is revisable until then.

Two operator decisions reshaped the ledger:

- **`apps/web` is a marketing site, built last.** The row that was D5 at the time inherited ADR-0022's "public/user-facing app: Next.js" identity; the operator has since named the actual user-facing product a **customer app** — staff-adjacent in shape, heavy on grids and forms — and demoted `apps/web` to marketing only. Like the D3 split, the re-scoping itself is a ledger decision; the frozen ADR-0022 gets its superseding roster ADR when D8 opens and an app actually changes, not before.
- **The customer app is a separate Vite SPA, not a mode of the admin panel.** The population boundary is the app boundary: ADR-0017's two populations, ADR-0033's one-population session machine, the customer-facing attack surface kept out of the origin where staff sessions live, and impersonation (D9) staying clean because the two sessions never coexist in one client. What the apps share is machinery, and D8 turns that machinery into packages.

The order is a dependency chain, not a preference ranking: **D6 (settings)** first among them because ADR-0041's adapter seam is the freshest contract in the repo and D7 needs a locale slot to persist into; **D7 (localization)** before any second app exists, so the retrofit sweep is paid exactly once and D8's extraction moves components already dictionary-fed; **D8 (extraction + customer app)** as one deliverable because the second consumer is what makes an extraction honest; **D9 (impersonation)** last in the cluster because it signs into the app D8 builds and is the riskiest surface in the ledger; **D10 (marketing)** last outright, by the operator's call.
