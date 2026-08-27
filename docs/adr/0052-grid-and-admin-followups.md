# ADR-0052: Grid and admin follow-ups — visible state, felt navigation, and the browser tier

- Status: proposed
- Date: 2026-08-28
- Supersedes: [ADR-0039](0039-grid-filter-ux.md) (delta: hot filters get chips); [ADR-0048](0048-app-shell-and-record-surfaces.md) (delta: the shell gains a navigation indicator)

> Written 2026-08-28 ahead of D10 opening ([`docs/plan/0010-grid-and-admin-followups.md`](../plan/0010-grid-and-admin-followups.md)), while D9 is still in progress — writing is not opening. Accepted at the head of `D10.1`, where both parents move to `superseded by ADR-0052`; amendable in place while D10 is `in progress` (ADR-0025 rule 2). A delta supersession per [ADR-0050](0050-adr-lifecycle-and-verification.md): **each parent's delta is stated below, and everything else in both stands as written and is in force as part of this record.** The Playwright tier is additive, in the slot [ADR-0036](0036-admin-testing-strategy.md) §What-is-deferred explicitly reserved for "a separate decision with a separate ADR".

## Context

D10 is the operator's follow-up list, run after the extraction so everything lands in the packages both apps consume (`@repo/grid`, `@repo/ui`) rather than in code that was about to move. Two threads: **visible state** — grid affordances the operator asked for by name — and **felt performance** — a diagnosed navigation delay whose causes are dev-only chunk transforms, a total absence of pending feedback, and an unmeasured remount cost; the caching layer was read and exonerated (`staleTime`, `keepPreviousData` and intent preload are already in place). A third thread cashes a five-deliverable-old IOU: every close-out since D3 has carried browser items "accepted by the operator rather than machine-verified", which is the condition ADR-0036 named for building the end-to-end tier.

## Decision

### Visible state, in `@repo/grid`

- **A pressed hot filter renders its chip.** ADR-0039 suppressed the chip while a hot-filter button showed the same state, to avoid saying one thing twice; the operator's call is that the applied-filters bar always shows every applied filter, hot ones included — one place that answers "what am I looking at?", duplication accepted. Suppression by filter entry is retired; **Clear all keeps clearing hot filters too**, and everything else ADR-0039 decided — the bar, one chip per `Filter`, removal semantics, the live region — stands.
- **The column resize handle is visible at rest**, in both themes, not only on hover. Styling in `@repo/grid`; the affordance is asserted by the browser tier below, since jsdom cannot see it.
- **The columns menu gains drag-and-drop reordering** — a drag handle on each row's left, the existing up/down buttons kept on the right for single-step and keyboard-first use. The dependency is **`@dnd-kit`** (core + sortable), chosen for its keyboard operability and small surface; it is `@repo/grid`'s dependency, no app's. Order still lands in ADR-0041's preferences exactly as the buttons' order does — the input gesture changes, the state's path does not.
- **Striped rows**: a grid prop alternating row background, **off by default**; a consumer opts in. No preference, no URL state — it is a presentation choice the page makes.
- **Row virtualization stays out**, with its threshold written down: adopt `@tanstack/react-virtual` when a consumer needs more than ~100 rows per page. No shipped screen does, and the work would touch the ADR-0037 height contract for headroom nobody uses.

### Felt navigation: measure first, then the two fixes

- **The profile precedes the fixes.** The nav-delay work starts by profiling a **production build** (`vite preview` + React Profiler) and recording the numbers in the plan; dev-mode feel is not evidence (StrictMode double-mounts and on-demand transforms exist only there). Grid-mount optimisation happens only if those numbers earn it.
- **`AppShell` gains a `navigating?: boolean` prop** rendering a slim indeterminate progress bar across the top of the inset when true, nothing when absent. The shell stays routing-ignorant (ADR-0047's rule holds): **the app computes** `useRouterState().status === "pending"` and hands the boolean down — the same division as `fullHeight`. This is the delta on ADR-0048 §2's inventory; the slot-honesty rule is satisfied by the admin panel itself, today.
- **Dev warmup**: `apps/admin`'s Vite config gains `server.warmup` over the page files, so the first click per route in `pnpm dev` stops paying an on-demand transform. `React.StrictMode` stays — it is dev-only and catches real bugs.

### The browser tier: Playwright, scoped to the standing walk

**`apps/admin` gains an end-to-end tier** — Playwright, chromium only — whose scope is exactly the recurring close-out walk and nothing speculative: sign-in; both grids scrolling rows under a static header and pager with no page-level horizontal scrollbar; sort, filter and a hot filter applied and visible; a record opened in each surface variant; a long form keeping title and Save visible; the resize handle visible at rest. It runs as **`test:e2e`, `cache: false`**, against the dev stack (API + Postgres up), and is **not** part of `pnpm test` — the ADR-0026 gate keeps its shape, and the close-out checklist runs `test:e2e` beside it. MSW stays the component tier's boundary (ADR-0036 stands); this tier exists to see what jsdom cannot, not to re-test what it can.

### The bundle budget

`apps/admin`'s build gains a **size budget checked by the gate**: a committed budget file, a script comparing the built output against it, failing when exceeded. The baseline is recorded when the check lands; raising the budget is a reviewed diff of that file, never a silent drift. The customer app inherits the mechanism at D11.

## Consequences

- The grid's answer to "what am I looking at?" is complete in one place, at the cost ADR-0039 weighed — a chip and a pressed button saying the same thing.
- `@repo/grid` takes its first interaction dependency (`@dnd-kit`); consumers pay it whether or not they open the columns menu — accepted, it is small and tree-shakeable.
- Navigation gets feedback in every app that mounts `AppShell`, and the perf work is anchored to numbers instead of feel.
- The operator-acceptance backlog shrinks structurally: what the close-out walk checked by hand, `test:e2e` checks by machine — while needing a running stack, which is why it stays out of the cached gate.
- Two more frozen records take delta supersessions; the pattern from 0051 (parents stand by reference) is now the norm.

## Alternatives considered

- **Keep ADR-0039's chip suppression.** Principled — one state, one indicator — and rejected by the operator for consistency: the bar is the inventory, and an inventory with an exception is read twice.
- **Native HTML5 drag-and-drop.** No dependency, and keyboard-inaccessible with inconsistent previews; the up/down buttons would carry accessibility alone. Rejected.
- **Ship the nav fixes without profiling.** Cheaper today; if the felt delay survives in production the work starts over without a baseline. Rejected — measurement is one step.
- **A pending route component instead of the shell indicator.** Replaces the old screen with a flash of skeleton on every navigation — worse than the delay it masks. Rejected; the indicator keeps the old screen and adds feedback.
- **E2E inside `pnpm test`.** Would put a browser and a running stack inside the cached gate ADR-0026 shaped; rejected, `test:e2e` stands beside it.
