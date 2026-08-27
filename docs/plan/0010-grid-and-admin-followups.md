# D10 — Data grid and admin follow-ups

- Status: **planned** — opens when [D9](0009-platform-extraction.md) ships; **scoped 2026-08-28** (`/scope`, ADR-0050) from the two operator-named sections below. The decisions are in [ADR-0052](../adr/0052-grid-and-admin-followups.md), `proposed`, accepted at the head of `D10.1`, where [ADR-0039](../adr/0039-grid-filter-ux.md) and [ADR-0048](../adr/0048-app-shell-and-record-surfaces.md) move to `superseded by` (deltas — everything else in both stands by reference). Opening is the ledger row moving to `in progress` — the operator's decision, not a formality
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

## Build order

### 1. The records, the profile, and the felt click

**ADRs:** [0052](../adr/0052-grid-and-admin-followups.md) (accepted at the head of this step; 0039 and 0048 move to `superseded by`), [0047](../adr/0047-ui-package-scope.md), [0037](../adr/0037-grid-viewport-layout.md)

Acceptance mechanics first, then the nav-delay package in its decided order: profile a **production build** (`pnpm build --filter admin`, `vite preview`, React Profiler over the left-nav walk) and record the numbers here; `AppShell` gains the `navigating?: boolean` prop and its indeterminate bar; `apps/admin` computes `useRouterState().status === "pending"` and hands it down; `vite.config.ts` gains `server.warmup` over the page files. Grid-mount work only if the profile's numbers earn it — recorded either way.

**Done when:** the profile numbers are written into this section as an amendment; a `@repo/ui` test asserts the bar renders under `navigating` and leaves no node otherwise; an admin test asserts the wiring; ADR statuses and index cells flipped; the gate green.

### 2. Visible state: the chip, the handle, the stripes

**ADRs:** [0052](../adr/0052-grid-and-admin-followups.md), [0039](../adr/0039-grid-filter-ux.md) as carried

In `@repo/grid`: the applied-filters bar renders a chip for a pressed hot filter (suppression retired; Clear all unchanged); the resize handle gets its at-rest affordance in both themes; the `striped` prop lands, off by default.

**Done when:** the bar's suite asserts a chip for a pressed hot filter and its removal unpressing the filter; a test asserts stripes only when the prop is set; the handle's visibility is a named `test:e2e` spec at `D10.4`; the gate green.

### 3. The columns menu learns to drag

**ADRs:** [0052](../adr/0052-grid-and-admin-followups.md), [0041](../adr/0041-grid-preferences.md)

`@dnd-kit` (core + sortable) enters `@repo/grid`; the columns menu rows gain a left drag handle, keep the right-side up/down buttons, and drags land in ADR-0041's preferences exactly as button clicks do. If a split of `app-grid.tsx` happens, it happens here, inside the step already editing it.

**Done when:** a suite asserts keyboard-operated reorder through the sortable updates the preference and reset-to-defaults still works; `@dnd-kit` appears in `packages/grid` only; the gate green.

### 4. The browser tier

**ADRs:** [0052](../adr/0052-grid-and-admin-followups.md), [0036](../adr/0036-admin-testing-strategy.md) as carried

Playwright, chromium, `test:e2e` (`cache: false`) against the dev stack: sign-in; both grids with static header and pager, rows the only scroller, no page-level horizontal scrollbar; sort, filter and a pressed hot filter visible in the bar; a record opened in each surface variant; a long form keeping title and Save visible; the resize handle at rest; the navigation indicator during a slow route.

**Done when:** `pnpm test:e2e` green against the local stack; the specs cover every recurring close-out walk item this file's history names; `pnpm test`'s shape and caching are untouched.

### 5. The budget

**ADRs:** [0052](../adr/0052-grid-and-admin-followups.md), [0026](../adr/0026-task-graph-caching-and-serialisation.md)

The committed budget file, the check script wired into the gate for `apps/admin`'s build, the baseline recorded in the budget file's first commit.

**Done when:** the check passes at baseline and fails on a deliberately breached budget (asserted once, then reverted); the gate green.

### 6. Close-out

**ADRs:** none of its own — the checklist below

**Done when:** every §Definition-of-done item is checked or recorded as pending operator acceptance; the row reads `shipped`; the window on 0052 is shut.

## Definition of done

1. **The numbers exist**: the production-build profile is recorded in `D10.1`, before and (where work happened) after.
2. **Visible state is asserted**: hot-filter chips, stripes and DnD reorder by unit suites; the handle, the indicator and the walk by `test:e2e`.
3. **The gate keeps its shape**: `pnpm lint && pnpm check-types && pnpm test` green and cached exactly as before; `test:e2e` green beside it against the dev stack.
4. **The budget stands**: the size check is in the gate, its baseline committed.
5. **Records agree**: 0052 `accepted` with labelled amendments; 0039 and 0048 `superseded by ADR-0052`; index cells and window documents in one reading pass.
