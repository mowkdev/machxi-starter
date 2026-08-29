# D10 — Data grid and admin follow-ups

- Status: **in progress** — **opened 2026-08-29**, the operator's decision, the day after [D9](0009-platform-extraction.md) shipped; **scoped 2026-08-28** (`/scope`, ADR-0050) from the two operator-named sections below. The decisions are in [ADR-0052](../adr/0052-grid-and-admin-followups.md), `proposed`, **revised 2026-08-29 while proposed** (three corrections at opening — see §The corrections below), accepted at the head of `D10.1`, where [ADR-0039](../adr/0039-grid-filter-ux.md) and [ADR-0048](../adr/0048-app-shell-and-record-surfaces.md) move to `superseded by` (deltas — everything else in both stands by reference)
- Steps: `D10.1` – `D10.6`
- Ledger: [`docs/plan/README.md`](README.md)

Scope: the work `apps/admin` and the data grid still owe, done **after** the extraction so that it lands in the packages both apps will use rather than in one app that then has to be re-extracted. That ordering is the whole reason this row exists here rather than earlier: a grid capability added in D8 or D9 would be added to code that is moving, and a grid capability added after the customer app exists is added twice.

**The scope is the operator's to name.** What follows is first what the operator has named, then what this repository has already written down as deferred — the latter a candidate list to draw from, not a plan, and not a claim that any of it is wanted.

## Named by the operator, 2026-08-26

Four grid items, recorded while D8 was being planned. They wait here rather than joining D8 because D8's own boundary rule keeps the grid untouched, and this file's ordering argument applies to each: a grid capability added before the extraction is added to code that is moving.

- **The applied-filter badge shows for hot filters too.** Today a pressed hot filter deliberately suppresses its chip — ADR-0039's suppression rule, implemented and commented in `apps/admin/src/shared/grid/applied-filters.tsx` — so a view filtered only by hot filters shows just Clear all. The operator wants the applied-filter indication always visible when any filter is applied, hot filters included; the duplication is accepted for UI consistency. This reverses a decision frozen in ADR-0039, so at scoping it is a supersession to argue, not a style tweak.
- **The column resize handle is visible at rest.** Currently the handle only appears on hover; it needs a visible affordance in both light and dark themes (resize lives in `app-grid.tsx` / `columns.tsx`).
- **Drag-and-drop reordering in the columns menu.** `columns-menu.tsx` (ordering and reset-to-defaults) gains drag-and-drop: a drag-handle icon on the left of each column row, with the existing up/down icons kept on the right for one-step repositioning. Likely brings the app its first drag-and-drop dependency — named and decided at scoping.
- **Striped rows (zebra striping).** A grid prop option that alternates the row background colour on each nth row; off by default.

## Named by the operator, 2026-08-27 — the navigation delay, and four review outcomes

The operator reported a felt delay after clicking a left-nav item to switch resources, with cached data and no request in flight. **The diagnosis, from reading the shipped code** (the caching layer is not the cause — `staleTime: 30_000` globally, `placeholderData: keepPreviousData` on lists, `defaultPreload: "intent"` on the router are all already in place):

1. **Dev-only compounding, probably most of the felt delay**: `autoCodeSplitting` makes each page a lazy chunk that Vite transforms on first demand in `pnpm dev`, and `React.StrictMode` (`main.tsx`) then double-mounts the whole page tree — grid initialisation included — on every navigation. Neither exists in a production build.
2. **No pending feedback anywhere**: the router keeps the old screen while the next chunk resolves — no `defaultPendingComponent`, no `useRouterState` indicator — so however short the wait, the click reads as dead.
3. **Page remount cost** (the grid re-instantiates per navigation): real, secondary, and to be measured rather than guessed.

**Decided 2026-08-27** (options put to the operator, recommended answers taken):

- **The nav-delay step: measure, then the two fixes.** Profile a production build first (React Profiler + `vite preview`) so the work targets a number; then a **navigation pending indicator** — the app computes `useRouterState().status === "pending"` and hands `AppShell` a boolean, keeping the shell routing-ignorant per ADR-0047 — and **Vite `server.warmup`** over the page files so dev stops paying the first-visit transform. Grid-mount optimisation only if the profile earns it. `React.StrictMode` stays: dev-only, and it catches real bugs.
- **Playwright E2E enters D10's scope.** Promoted from the deferred list below: a small suite covering exactly the recurring close-out walk (sign-in, both grids scroll/sort/filter with header and pager static, a record opens in each surface, a long form keeps Save visible). Five deliverables of "accepted by the operator rather than machine-verified" is the case ADR-0036 said would make this worth building; the D8 walk items become its first specs.
- **Row virtualization is deferred with a threshold**: adopt `@tanstack/react-virtual` when a consumer needs more than ~100 rows per page; no shipped screen does, and the work would touch the ADR-0037 height contract — the riskiest part of the grid — for headroom nobody uses.
- **A bundle-size budget for `apps/admin`**: a build-size check with a committed budget that fails the gate when exceeded, baselined at D10. Cheap, mechanical, and the guard the D11 customer app inherits.

One opportunistic note for scoping: `app-grid.tsx` is the largest hand-written file in the repository, and the drag-and-drop and resize-handle items above will open it anyway — if a split into smaller units happens, it happens there, as part of a step that is already editing the file, never as its own churn.

## Already recorded as deferred, in the ADR index's _Planned_ list and in shipped plans

- **The `page` edit surface has no resource declaring it.** Recorded twice, at `D4.2` and again at `D5.5`: the shell has coverage, the config path into it does not. [D8](0008-app-shell-and-record-surfaces.md) rebuilds that shell, so this is the natural place to give it a real consumer.
- **A bounded URL-side filter schema.** `listQuerySearchSchema`'s `filterSchema` checks shape only — `field: z.string()`, scalar `value: z.unknown()`. ADR-0039's chips bar made an arbitrary deep-linked filter a _rendering_ surface; `D4.4` clamps the label, and the schema is where the length belongs.
- **Negated filter operators** — no `ne` / `notLike` / `notIn` in ADR-0014's `FILTER_OPS`, so no filter dialog may offer "not contains". A supersession of frozen ADR-0014 and an API change, not a UI change.
- **Bulk mutation endpoints.** ADR-0038 fans bulk delete out client-side on purpose, because the ADR-0028 refusals are per-item. A transactional endpoint becomes worth deciding if scale makes N requests the problem.
- **Saved views** — named, shareable bundles of view state. ADR-0041 §Alternatives calls this "the legitimate version" of the want it rejected (persisting filters and sort as preferences), and D5 made it nearly free: a saved view is a named URL, because the URL is now a readable, valid API query.
- **End-to-end browser tests (Playwright).** ADR-0036 defers them; every deliverable since has closed with items marked "accepted by the operator rather than machine-verified", and that list is the argument for them. **Promoted into scope by the operator 2026-08-27** — see the section above.
- **Per-request principal freshness** and **a per-principal budget for expensive routes** — both API-side, both in the index's _Planned_ list with their reasoning.

## What this deliverable is not

Not a redesign of anything D8 or D9 touched. If the grid needs a different shape than the one that lands in the packages, that is a finding against those deliverables, made at their review rather than worked around here.

## The decisions, taken 2026-08-28

All in [ADR-0052](../adr/0052-grid-and-admin-followups.md): the hot-filter chip suppression is retired (delta on 0039), `AppShell` gains a `navigating` prop with the app computing router state (delta on 0048), the columns menu takes `@dnd-kit` as `@repo/grid`'s dependency, striping is an opt-in prop, the nav-delay work is measure-first, Playwright lands as `test:e2e` beside the cached gate (the slot 0036 reserved), the bundle budget fails the gate when exceeded, and virtualization stays out at a written ~100-rows threshold. The remaining candidates above (negated operators, bulk endpoints, the bounded filter schema, saved views) are **not** in D10 — each is a supersession or an API change that waits for a deliverable that wants it.

## The corrections, taken 2026-08-29 at opening

A review of the scope against the code found three underdecided points; options were put to the operator and the answers are revised into the still-`proposed` ADR-0052:

- **The profile's instrument was impossible as written.** "React Profiler over `vite preview`" cannot happen — the Profiler refuses to attach to a production bundle, and a dev-mode profile measures StrictMode's world. Decided: a **Chrome DevTools Performance trace** over the plain production preview, reading scripting and rendering time per navigation. The profiling-build alias (react-dom's profiling bundle in a `--mode profile` build) is the named fallback if the trace's number is big enough to need per-component attribution.
- **"In the gate" contradicted "the gate keeps its shape".** The gate never built `apps/admin`, so the size check had nothing to measure. Decided: a **cached `size` turbo task depending on `build`**, and the gate chain grows — `pnpm lint && pnpm check-types && pnpm test && pnpm size` — near-free when nothing changed. §Definition of done item 3 is reworded accordingly.
- **The E2E tier had no data rules.** "Against the dev stack" means a database that drifts with use. Decided: **invariant specs, never row counts**; sign-in via env-supplied credentials defaulting to the seeded super admin; dev fixtures assumed present; the suite cleans up what it writes.

Two mechanics noted for their steps rather than decided here: the "indicator during a slow route" spec needs a deliberately delayed chunk (Playwright route interception) to be deterministic (`D10.4`), and `@dnd-kit`'s React 19 peer range is verified at the head of `D10.3` before it enters `packages/grid`.

## Build order

### ~~1. The records, the profile, and the felt click~~ — **done 2026-08-29**

**ADRs:** [0052](../adr/0052-grid-and-admin-followups.md) (accepted at the head of this step; 0039 and 0048 move to `superseded by`), [0047](../adr/0047-ui-package-scope.md), [0037](../adr/0037-grid-viewport-layout.md)

Acceptance mechanics first, then the nav-delay package in its decided order: profile a **production build** (`pnpm build --filter admin`, `vite preview`, a **Chrome DevTools Performance trace** over the left-nav walk — scripting and rendering time per navigation; not the React Profiler, which does not attach to production bundles) and record the numbers here; `AppShell` gains the `navigating?: boolean` prop and its indeterminate bar; `apps/admin` computes `useRouterState().status === "pending"` and hands it down; `vite.config.ts` gains `server.warmup` over the page files. Grid-mount work only if the trace's numbers earn it — recorded either way.

**Done when:** the profile numbers are written into this section as an amendment; a `@repo/ui` test asserts the bar renders under `navigating` and leaves no node otherwise; an admin test asserts the wiring; ADR statuses and index cells flipped; the gate green.

**Amended 2026-08-29 (D10.1) — the instrument.** The DevTools Performance trace was not the instrument, and this record says so rather than claiming a trace nobody ran: **a Performance-trace UI cannot be started from the browser-automation surface this session drives Chrome through**, which makes the trace an operator gesture rather than a step's work. What ran instead is an **in-page harness** measuring the two quantities the trace was wanted for — per-navigation wall time from the click to the first paint after the destination has settled (`requestAnimationFrame`-bounded), and main-thread **long-task** time inside that window (`PerformanceObserver`, `type: "longtask"`) — driven over the left-nav walk against `vite preview`. [ADR-0052](../adr/0052-grid-and-admin-followups.md) §Felt navigation carries the same amendment. **One gotcha, recorded for `D10.4`:** a Chrome tab that is not the _selected_ tab of its window reports `document.visibilityState === "hidden"`, which suspends `requestAnimationFrame` entirely and throttles timers — every measurement taken there is worthless, and the first attempt at this walk produced nothing but 45-second timeouts because of it.

**Amended 2026-08-29 (D10.1) — the numbers, and what they earn.** Both bundles built from this repository (`pnpm build --filter admin`) and served by `vite preview` on port 3002 against the local API and the dev database; Chrome, one machine (16 logical cores), foreground tab. **Before** is the D10-opening commit `5162d68`, restored by the same build command from the turbo cache — the cache doing its job as a time machine. **After** is this step's tree. Identical protocol both times: a reload, one cold visit per route, then three warm rounds of the four.

| Navigation       | cold, before | cold, after | warm median, before | warm median, after | warm range, after |
| ---------------- | -----------: | ----------: | ------------------: | -----------------: | ----------------: |
| → Staff (grid)   |       177 ms |      223 ms |               80 ms |              66 ms |          64–84 ms |
| → Users (grid)   |       214 ms |      163 ms |              118 ms |             117 ms |        100–150 ms |
| → Dashboard      |       104 ms |       57 ms |               35 ms |              38 ms |          34–52 ms |
| → Profile (form) |        94 ms |      139 ms |               34 ms |              31 ms |          31–33 ms |

Main-thread long tasks across the twelve warm navigations: **four to five of them carry exactly one — 52–157 ms before, 57–105 ms after** — and the rest carry none at all. A grid page's warm navigation is therefore _one task_, and that task is the grid mounting.

**Three things follow, and all three are decisions this step is allowed to take.**

1. **Grid-mount optimisation is not earned, and is not done.** ADR-0052 made it conditional on the numbers; a warm resource navigation in a production build is **66–117 ms at the median** — at the ~100 ms instant threshold, and just above it on the slower of the two grids, not under it everywhere. The remount cost is real — it is the single long task above — and it is not what the operator felt.
2. **The felt delay was the dev build, as diagnosed.** Nothing here can produce a noticeable wait, which is the evidence for §Felt navigation's first cause: on-demand chunk transforms plus `StrictMode`'s double mount, neither of which exists in this build. `server.warmup` is the fix aimed at exactly that, and it is dev-only by construction — **so it does not appear in this table and cannot**.
3. **The indicator costs nothing measurable.** Every warm median after the change sits inside the run-to-run spread of the same route before it, in both directions (Staff and Profile came out faster, Dashboard slower by 3 ms). The cold column is one sample per cell and shows the same spread, which is why nothing is claimed from it.

**And the bar was seen in the production build, doing the one thing it is for.** It appeared in **3 of the 16 measured navigations — every one of them a cold visit** — and in none of the warm ones, which is the behaviour worth having: a navigation that resolves inside a frame gets no flicker, one that has something to wait for gets an answer. It was then held open deliberately, by opening a record whose loader had a real request in flight, and read from the live DOM: `role="progressbar"` with no `aria-valuenow`, `aria-label="Navigating"`, `data-slot="navigation-indicator"`. **What is not certified is the pixels** — the bar's 2px geometry, its colour in both themes and its motion were not captured, and are `D10.4`'s spec (ADR-0052 assigns exactly this kind of claim to the browser tier) or the operator's eye before then.

### ~~2. Visible state: the chip, the handle, the stripes~~ — **done 2026-08-29**

**ADRs:** [0052](../adr/0052-grid-and-admin-followups.md), [0039](../adr/0039-grid-filter-ux.md) as carried

In `@repo/grid`: the applied-filters bar renders a chip for a pressed hot filter (suppression retired; Clear all unchanged); the resize handle gets its at-rest affordance in both themes; the `striped` prop lands, off by default.

**Done when:** the bar's suite asserts a chip for a pressed hot filter and its removal unpressing the filter; a test asserts stripes only when the prop is set; the handle's visibility is a named `test:e2e` spec at `D10.4`; the gate green.

**Amended 2026-08-29 (D10.2) — what the reversal cost, and three decisions inside it.**

- **The suppression's machinery went with the rule.** `displayedByHotFilters` had exactly one consumer, and retiring ADR-0039's rule left it a function with no caller — so it is deleted, with its `describe` block, rather than left exported against a decision that has been reversed. The `hotFilters` prop went off `AppliedFilters` with it, and with that prop went the `NO_HOT_FILTERS` dance at the call site: `AppGrid` used to hand the bar an empty list whenever a screen replaced the toolbar, or those filters would have been displayed by nothing at all. **The reversal deleted a special case rather than adding one**, which is the shape of it worth remembering.
- **The handle's affordance is a token, not a colour.** The 6px band stays transparent until hover — six pixels of colour on every column edge would read as a second set of borders — and what is now always there is a centred `after:` hairline in `bg-border`. "Visible in both themes" is then true by construction: it answers from the same variable the table's own rules do, so there is no second value for a palette change to miss. `h-4` centred rather than full height is what keeps it a handle instead of a column divider.
- **The stripe is a CSS selector, not an index.** `striped` puts `even:bg-muted/30` on every body row and lets the browser decide which rows are even. A computed index would have to stay honest against every other branch that renders a `<TableRow>` — loading, empty and error rows are all rows — and it would be the component keeping a count it does not need. `hover` and `data-[state=selected]` sort after `even` in Tailwind's variant order, so a striped row still answers the pointer and still shows that it is selected; that is asserted rather than assumed.

**Pending operator acceptance**: **no shipped screen sets `striped`**, which is what ADR-0052 asked for — off by default, a consumer opts in — and means the prop's only consumer today is its test. Say the word and staff or users takes it. And the two pixel facts stay pixel facts: the grip's visibility at rest and the stripe's legibility in light and dark are `D10.4`'s specs (the handle by name) or your eye before then. What jsdom can see is asserted here — the classes are on the elements, in both the on and off cases.

### 3. The columns menu learns to drag

**ADRs:** [0052](../adr/0052-grid-and-admin-followups.md), [0041](../adr/0041-grid-preferences.md)

`@dnd-kit` (core + sortable) enters `@repo/grid` — its React 19 peer range verified at the head of the step, before the dependency lands; the columns menu rows gain a left drag handle, keep the right-side up/down buttons, and drags land in ADR-0041's preferences exactly as button clicks do. If a split of `app-grid.tsx` happens, it happens here, inside the step already editing it.

**Done when:** a suite asserts keyboard-operated reorder through the sortable updates the preference and reset-to-defaults still works; `@dnd-kit` appears in `packages/grid` only; the gate green.

### 4. The browser tier

**ADRs:** [0052](../adr/0052-grid-and-admin-followups.md), [0036](../adr/0036-admin-testing-strategy.md) as carried

Playwright, chromium, `test:e2e` (`cache: false`, `SEED_SUPER_ADMIN_*` in its `env` per ADR-0026) against the dev stack: sign-in with env-supplied credentials defaulting to the seeded super admin; both grids with static header and pager, rows the only scroller, no page-level horizontal scrollbar; sort, filter and a pressed hot filter visible in the bar; a record opened in each surface variant; a long form keeping title and Save visible; the resize handle at rest; the navigation indicator during a route whose chunk is deliberately delayed by request interception, so the spec is deterministic. **Specs assert invariants, never row counts** — the dev database drifts with use, and the suite must be green over any database the seeds have touched; anything a spec writes, it cleans up.

**Done when:** `pnpm test:e2e` green against the local stack; the specs cover every recurring close-out walk item this file's history names; `pnpm test`'s shape and caching are untouched.

### 5. The budget

**ADRs:** [0052](../adr/0052-grid-and-admin-followups.md), [0026](../adr/0026-task-graph-caching-and-serialisation.md)

The committed budget file, and the `size` turbo task — cached, `dependsOn` `apps/admin`'s `build` — comparing the built output against it. **The gate chain grows its fourth link**: `pnpm lint && pnpm check-types && pnpm test && pnpm size`, and every document that states the gate (`CLAUDE.md`, the rule files, the skills) is swept in this step. The baseline is recorded in the budget file's first commit.

**Done when:** the check passes at baseline and fails on a deliberately breached budget (asserted once, then reverted); `pnpm size` is a cache hit when nothing changed; the gate green.

### 6. Close-out

**ADRs:** none of its own — the checklist below

**Done when:** every §Definition-of-done item is checked or recorded as pending operator acceptance; the row reads `shipped`; the window on 0052 is shut.

## Definition of done

1. **The numbers exist**: the production-build profile is recorded in `D10.1`, before and (where work happened) after.
2. **Visible state is asserted**: hot-filter chips, stripes and DnD reorder by unit suites; the handle, the indicator and the walk by `test:e2e`.
3. **The gate grows one link and nothing else moves**: `pnpm lint && pnpm check-types && pnpm test && pnpm size` green, the first three cached exactly as before and `size` a cache hit when the build is unchanged; `test:e2e` green beside the gate against the dev stack.
4. **The budget stands**: the `size` task is in the gate chain, its baseline committed.
5. **Records agree**: 0052 `accepted` with labelled amendments; 0039 and 0048 `superseded by ADR-0052`; index cells and window documents in one reading pass.
