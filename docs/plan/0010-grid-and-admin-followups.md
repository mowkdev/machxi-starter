# D10 — Data grid and admin follow-ups

- Status: **planned** — opens when [D9](0009-platform-extraction.md) ships. **This file is a placeholder**: the operator has said there is remaining grid and admin work and that it belongs here, after the extraction and before the customer app. Its scope is written when the deliverable is scoped, not now.
- Steps: written when the deliverable opens
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

## Decisions this deliverable needs

Unknown until the scope is named. Several of the candidates above (negated operators, bulk endpoints, a bounded filter schema) are supersessions of frozen ADRs rather than additive decisions, and the scoping session is where that gets established.
