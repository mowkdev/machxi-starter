# D10 — Data grid and admin follow-ups

- Status: **shipped 2026-08-29** — **scoped 2026-08-28** (`/scope`, ADR-0050) from the two operator-named sections below, **opened 2026-08-29** the day after [D9](0009-platform-extraction.md) shipped, six steps built, and **the window on [ADR-0052](../adr/0052-grid-and-admin-followups.md) shut with it** — that record is `accepted`, carrying three labelled amendments, and four parents took delta supersessions under it: [0039](../adr/0039-grid-filter-ux.md) and [0048](../adr/0048-app-shell-and-record-surfaces.md) at `D10.1`, [0026](../adr/0026-task-graph-caching-and-serialisation.md) and [0036](../adr/0036-admin-testing-strategy.md) at `D10.5`. Evidence: [`docs/plan/README.md`](README.md) §How D10 closed. **This line moved with the ledger row and the window** — D9's header records the cost of leaving it stale, and the lesson only counts if it is applied in the other direction too
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

### ~~3. The columns menu learns to drag~~ — **done 2026-08-29**

**ADRs:** [0052](../adr/0052-grid-and-admin-followups.md), [0041](../adr/0041-grid-preferences.md)

`@dnd-kit` (core + sortable) enters `@repo/grid` — its React 19 peer range verified at the head of the step, before the dependency lands; the columns menu rows gain a left drag handle, keep the right-side up/down buttons, and drags land in ADR-0041's preferences exactly as button clicks do. If a split of `app-grid.tsx` happens, it happens here, inside the step already editing it.

**Done when:** a suite asserts keyboard-operated reorder through the sortable updates the preference and reset-to-defaults still works; `@dnd-kit` appears in `packages/grid` only; the gate green.

**Amended 2026-08-29 (D10.3) — the peer check, a fourth package, and the split that did not happen.**

- **The peer range, verified at the head as the step required**: `@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@10.0.0`, `@dnd-kit/utilities@3.2.2` and `@dnd-kit/modifiers@9.0.0` all declare `react: ">=16.8.0"`, so React 19 is inside every one of them. **An open-ended range is a claim, not a test**, though — which is why the suite drives the real `sortableKeyboardCoordinates` gesture under React 19 rather than calling `onDragEnd` by hand: that is the part a version number cannot answer.
- **Four packages, not the two the step named.** `@dnd-kit/utilities` is `CSS.Transform.toString`, which is how a lifted row is moved at all, and `@dnd-kit/modifiers` is `restrictToVerticalAxis` — the list is a column, and an unrestricted drag carries the row out of the popover's 16rem width, where collision detection starts answering about nothing. Both are `@repo/grid`'s alone, like the two the ADR named.
- **The gesture is added, not substituted.** The grip is on the left and carries the drag listeners; the up/down arrows stay on the right, and `Reset to defaults` still undoes both. `AppGrid` grew one `reorderTo(from, to)` that the arrows and the drop both call, so ADR-0041's "order is one preference" is true by construction rather than by two writers agreeing. The drop reports **ids**, and the indices are resolved late against the preference — the menu renders an order it does not own.
- **`app-grid.tsx` was not split**, and the decision is recorded rather than left to be re-litigated: this step's edit to it was one callback becoming two plus a prop, and a structural split with no behaviour change is exactly the churn the step's own text says a split must not be. The file is still the largest hand-written one in the repository; the next step that genuinely restructures it is where it earns the move.

**Amended 2026-08-29 (D10.3) — what the review changed, because two of them were the reason the dependency was chosen.**

- **The screen-reader copy was `@dnd-kit`'s, in English, naming ids.** The library ships its own instructions ("To pick up a draggable item, press the space bar…"), its own `aria-roledescription`, and announcements that interpolate the item's **id** — so a grip labelled "Reorder Created" on screen announced itself as `createdAt`, in `lv` as in `en`. ADR-0052 §Alternatives rejected native HTML5 drag-and-drop precisely so the arrows would not carry accessibility alone, and shipping this would have left them carrying it anyway. Six keys now live in the package's own catalogues, in both locales, and the live region names the column.
- **Escape closed the menu instead of cancelling the drag.** The instructions advertise escape as the cancel gesture; Radix's dismiss layer is mounted before the sensor's document listener and answered first, so the operator lost the whole popover. `onEscapeKeyDown` now refuses the dismissal exactly while a drag is up.
- **And fixing the first two exposed a real bug in the third.** Tracking "is a drag up?" made the menu re-render mid-drag, which broke the drag: `useSensor` memoises on its options object, an inline literal is a new object every render, and `DndContext` re-initialises its sensors when that array changes. The lift still happened and still announced itself; only the arrow key did nothing, silently. The options are module constants now, and the comment above them says why. **No test would have caught this without the keyboard case** — a suite that fired `onDragEnd` by hand would have been green through all of it.
- **The done-when's "updates the preference" was not asserted.** The package's own suite drives the real sortable, but its harness re-implements the splice, so it proves the gesture and not where the result lands. A case in `apps/admin/src/shared/grid/__tests__/app-grid.test.tsx` now does the keyboard drag against the real `AppGrid`, `gridId` and storage, and asserts the persisted `order` — the same entry the arrows write.

**Recorded, not fixed** (a D9 leftover this step surfaced): **`pnpm i18n:check` does not see the packages' catalogues.** Its `LOCALES_DIR` is `apps/admin/src/shared/i18n/locales`, and D9 moved `@repo/grid`'s and `@repo/form`'s locale trees out of it — so every key those packages add, including this step's six, is unguarded in both directions, and `packages/*/eslint.config.js` carries no `no-literal-string` either. ADR-0046 §9 already decided what the check is for; widening the script to the workspace's `*/src/locales` trees is code rather than a new decision, and it belongs with `D10.5`'s document sweep or a step of its own rather than inside this one.

**Pending operator acceptance**: the pointer drag itself. The keyboard path is machine-checked end to end, but a mouse drag needs a layout engine — the suite gives jsdom stacked rects so `closestCenter` has centres to compare, and stacked rects are not a browser. `D10.4`'s spec or your hand on a mouse is what confirms the grip drags, the row lifts and the drop lands where it looks like it will.

### ~~4. The browser tier~~ — **done 2026-08-29**

**ADRs:** [0052](../adr/0052-grid-and-admin-followups.md), [0036](../adr/0036-admin-testing-strategy.md) as carried

Playwright, chromium, `test:e2e` (`cache: false`, `SEED_SUPER_ADMIN_*` in its `env` per ADR-0026) against the dev stack: sign-in with env-supplied credentials defaulting to the seeded super admin; both grids with static header and pager, rows the only scroller, no page-level horizontal scrollbar; sort, filter and a pressed hot filter visible in the bar; a record opened in each surface variant; a long form keeping title and Save visible; the resize handle at rest; the navigation indicator during a route whose chunk is deliberately delayed by request interception, so the spec is deterministic. **Specs assert invariants, never row counts** — the dev database drifts with use, and the suite must be green over any database the seeds have touched; anything a spec writes, it cleans up.

**Done when:** `pnpm test:e2e` green against the local stack; the specs cover every recurring close-out walk item this file's history names; `pnpm test`'s shape and caching are untouched.

**Amended 2026-08-29 (D10.4) — the session, and what the API taught the suite.**

The tier's shape is ADR-0052's: Playwright, chromium, `test:e2e` as a `cache: false` turbo task declaring `SEED_SUPER_ADMIN_*`, no `webServer`, invariants rather than row counts, and cleanup for the one spec that writes. What the record could not have predicted is how the **API's own security decisions** constrain a browser suite, and both cost a red run to find:

- **A sign-in per test is impossible.** ADR-0020's login limiter is ten per fifteen minutes per IP and email — a liveness control, since every admitted request costs an argon2 hash — so a suite that signed in per test exhausted it inside two spec files and then failed on a timeout waiting for the dashboard, which is a red suite that says nothing about the app.
- **And `storageState`, the standard answer to that, is unusable here** — because ADR-0018 **rotates the refresh token**. A saved state holds exactly one, so the first context to boot spends it and every later context replays a spent one, which the API correctly reads as a _failed_ refresh. Five of those trip the refresh limiter (5 per 15 min per IP, successful ones skipped) and lock the tier out for a quarter of an hour.

So the session lives where a session belongs: **one browser context for the whole run**, held by a worker-scoped fixture (`e2e/support/fixtures.ts`), with one worker. A healthy run costs **one login** and every refresh after it succeeds and is therefore not counted. This is not a workaround — it is the suite behaving like the operator it simulates, and it is worth knowing before D11's customer app grows a tier of its own.

**Two smaller things the browser corrected.** The sticky header moves **two pixels** on first scroll — it snaps to the pane's top edge from where `border-separate` leaves it at rest — so "static" is asserted as _did not travel with the rows_ against a scroll of hundreds, not as pixel equality. And the specs cover **dialog and drawer only**: no resource declares the `page` edit surface, which this file has recorded as deferred since `D4.2` and which is not this step's to close.

**And on its first real run it found a shipped defect, which is the whole case for building it.** The resize handle was `width: 0` with a default cursor — an affordance no pointer could grab — and `D10.2`'s at-rest grip and striped rows had landed dead. The cause is **D9's extraction**: `packages/ui/src/styles/globals.css` registers `@source "../../src"` for its own tree, and when the rendering code moved into `@repo/grid` and `@repo/form` nothing followed it, so a class used _only_ inside those packages was scanned by nothing and its utility was never generated. The rule did not fail — it did not exist.

It survived D9's close-out, D10.2's review and a hand walk because the damage is invisible: every class those packages share with the app or the design system — `sticky`, `overflow-auto`, `flex` — kept working, so the grid looked correct. `overflow-auto` in particular was being generated only because a _test file_ in `apps/admin` happens to mention it. Two `@source` lines fix it (`grid` and `form`, the only two packages holding a `className`), and the browser now reports the handle at 6px with `cursor: col-resize` and a 1×16px grip in the border token.

**The review found the suite lying about its own data rule, which is worth recording as the sharpest thing in this step.** Two layout specs asserted a scroll — and a _freshly seeded_ database has three staff and three users, which against the pane's `min-h-64` floor never overflow at any viewport. They were green here only because this machine's database has accumulated rows: a row-count assertion in a costume, passing for the one reason ADR-0052's data rule forbids. The scroll case now skips itself when the pane has nothing to scroll, and the one-scroller case asserts _no second scroller_ rather than exactly one. Three more from the same pass: the drag spec's Reset moved into `afterEach` so an account preference is restored on the failing path too; the held route in the navigation spec is released and unrouted in a `finally`, so a failure there stops poisoning the next file with a sixty-second hang; and `playwright.config.ts` now loads the root `.env` itself, because declaring `SEED_SUPER_ADMIN_*` on a turbo task makes it passable rather than present (ADR-0026's D2.1 lesson: a variable that is not loaded does not fail loudly, it defaults quietly).

**What the tier now certifies that no previous close-out could**: both grids' sticky header and static pager under a real scroll, one scroll container and no page-level horizontal scrollbar, a sort written into the URL in the API's own language, a pressed hot filter and its chip together (`D10.2`'s reversal), the resize handle's grip painted at rest with a non-transparent colour (`D10.2`), a record opening in each of the two declared surfaces at the same shape of URL, a form taller than its viewport keeping title and Save, the navigation indicator during a deliberately held route (`D10.1`), and the pointer drag `D10.3` could not reach — which also puts the column order back through Reset, because ADR-0045 makes that order an account fact rather than a local scribble.

### ~~5. The budget~~ — **done 2026-08-29**

**ADRs:** [0052](../adr/0052-grid-and-admin-followups.md), [0026](../adr/0026-task-graph-caching-and-serialisation.md)

The committed budget file, and the `size` turbo task — cached, `dependsOn` `apps/admin`'s `build` — comparing the built output against it. **The gate chain grows its fourth link**: `pnpm lint && pnpm check-types && pnpm test && pnpm size`, and every document that states the gate (`CLAUDE.md`, the rule files, the skills) is swept in this step. The baseline is recorded in the budget file's first commit.

**Done when:** the check passes at baseline and fails on a deliberately breached budget (asserted once, then reverted); `pnpm size` is a cache hit when nothing changed; the gate green.

**Amended 2026-08-29 (D10.5) — what is weighed, and the one thing the task graph got wrong.**

- **Three numbers, gzipped**: every JavaScript byte the build emits, every CSS byte, and the **entry chunk** — the one an operator pays before anything renders. A single total would let the entry double while lazy routes shrank; a per-file budget would need editing on every content hash. Gzip because that is what a browser downloads, and because this app is mostly long class strings and JSON catalogues, which raw bytes wildly overstate.
- **The baseline, measured on this tree**: **js 328.0 kB, css 12.3 kB, entry 252.4 kB** gzipped (the entry re-measured at the review, which found the first number was a _sum_ of the real entry and an unrelated 0.6 kB chunk), with budgets at 353.5 / 13.7 / 273.4 kB — about 8% of headroom, and 11% on `css`, where a percentage of 12 kB is noise. It is the first build in which `@repo/grid`'s and `@repo/form`'s utilities actually reach the CSS (`D10.4`'s fix), so the css number is real for the first time.
- **`turbo run size` unfiltered was wrong, and the graph said so.** `size` declares `dependsOn: ["build"]`, and turbo plans that pair for _every_ package — so a bare run pulled a full Next.js build of the marketing site into a check about `apps/admin`. The root script filters to `admin`. D11's customer app joins the filter when it gets a budget of its own, which is a visible edit rather than an inherited surprise.
- **Both directions proven, as the done-when asks.** At baseline the check passes; with `entry` lowered to 200 kB it exits 1 and names the breach ("entry is 253.0 kB, over its 195.3 kB budget by 57.7 kB"), then the budget was restored and it passes again. And `pnpm size` on an unchanged tree is **2/2 cached, `>>> FULL TURBO`, 50 ms** — which is the whole argument for putting it in the gate rather than beside it.
- **The gate chain grew its fourth link in nine documents**: `CLAUDE.md` (twice), the `gate-runner` agent's description _and_ its tool allowlist, `.claude/settings.json`'s permission allowlist, `.claude/README.md`, and the `local-dev`, `step`, `frontend-conventions` and `new-resource-ui` skills. Two of those the review had to find: `.claude/README.md`'s parenthetical states the current gate rather than describing the retired pipeline, and this amendment first claimed otherwise; and an agent's `tools:` frontmatter **narrows** what it may reach for without **granting** permission, so the haiku gate-runner would have blocked on a prompt at the fourth link — an agent told to run a command the permission layer refuses is a worse failure than not being told. `Bash(pnpm check*)` went into the same allowlist, a pre-existing gap the same reading exposed: the agent's _default_ command was not covered either.
- **And the fourth link is a supersession, which this step first failed to record.** ADR-0026 does not describe the three-command gate, it decides it — "It does not grow a fourth command" — and ADR-0036 restates that as its own. Both are frozen, so both move to `superseded by ADR-0052` as deltas, with every caching and testing rule in them standing. Leaving them `accepted` would have left the index telling a reader that this step violates a record in force, which is exactly the stop-condition `CLAUDE.md` names.

### ~~6. Close-out~~ — **done 2026-08-29**

**ADRs:** none of its own — the checklist below

**Done when:** every §Definition-of-done item is checked or recorded as pending operator acceptance; the row reads `shipped`; the window on 0052 is shut.

**Amended 2026-08-29 (D10.6).** All three happened together, and the evidence is in [`docs/plan/README.md`](README.md) §How D10 closed. Each §Definition-of-done item was **re-run rather than recalled**: lint 16/16 and check-types 15/15 both fully cached, `pnpm test` 14/14 at `0 cached`, `pnpm size` 3/3 budgets inside their limits and `>>> FULL TURBO` in 47 ms on the repeat, `pnpm test:e2e` 14/14 in 26.5 s through the new turbo task, `format:check` clean, and the four ADR statuses read from the files themselves. One thing did not pass first time and is recorded rather than retried into silence — see the flake below.

## Definition of done

1. ~~**The numbers exist**~~ — **met** (`D10.1`): the production-build profile is recorded before and after, and it bought a decision rather than decorating one — the grid-mount optimisation ADR-0052 made conditional was declined on the numbers.
2. ~~**Visible state is asserted**~~ — **met**: chips, stripes and the keyboard DnD reorder by unit suites (`@repo/grid`'s own and the admin's, the latter against the real preference store); the handle, the indicator, the pointer drag and the walk by `test:e2e` — **less the `page` edit surface, which no resource declares** (deferred since `D4.2`), and less the pixel judgements the tier cannot make: it asserts a painted box and a non-transparent colour in one theme, not that either reads well. §How D10 closed lists what that leaves open.
3. ~~**The gate grows one link and nothing else moves**~~ — **met** (`D10.6`): lint 16/16 and check-types 15/15 at _fully_ cached, `pnpm test` 14/14 at `0 cached` in 2m49 (its `cache: false` shape untouched), `pnpm size` green and `>>> FULL TURBO` in 47 ms on an unchanged tree, `pnpm test:e2e` 14/14 in 26.5 s beside the gate. `pnpm test:unit` is still the cached fast loop, 13/14 cached on a repeat run.
4. ~~**The budget stands**~~ — **met** (`D10.5`): `apps/admin/size-budget.json` is committed at js 328.0 / css 12.3 / entry 252.4 kB gzipped, the `size` task is the gate's fourth link, and the check was proven to fail on a deliberately breached budget as well as to pass on this one.
5. ~~**Records agree**~~ — **met** (`D10.6`), and with two more parents than this line anticipated: 0052 is `accepted` carrying three labelled amendments (the profile's instrument, what the numbers bought, and the fourth link's supersession); **0039, 0048, 0026 and 0036** all read `superseded by [ADR-0052]` in their own files; the index cells, the ledger row and every window document were swept in one pass.
