# D4 — Data grid v2

- Status: **in progress**, opened 2026-08-20 — the day D3 shipped ([ADR-0025](../adr/0025-deliverables.md) rule 5: one at a time)
- Steps: `D4.1` – `D4.7`
- Ledger: [`docs/plan/README.md`](README.md)

Scope: the second pass over the admin panel's largest surface. D3 proved the config-driven machinery — AppGrid on TanStack Table v9 in manual mode, one `ResourceConfig` per resource, the URL owning list state — and shipped with the seams this deliverable fills: two layout defects (a page-level horizontal scrollbar, a sidebar transition the content ignores), no viewport-height strategy, an always-visible filter row that inflates column widths, edit surfaces invisible to the URL, no row selection, no toolbar, and none of the column ergonomics ADR-0035 explicitly deferred "until a need names it". D4 names it. **`apps/admin` and `packages/ui` only — no API change anywhere in this deliverable**; the one place the requirements brushed the API (bulk delete) is deliberately answered client-side (ADR-0038).

Everything here builds on decisions that stand unchanged: the server owns data operations (ADR-0035), the URL owns view state (ADR-0034), configs are serializable data with functions in registries (ADR-0035), and the v9 features model means every new grid capability is an imported feature module, not a flag on dead code (ADR-0035, amended D3.6).

Each step names the ADRs that govern it. Read them before implementing — they carry the reasoning, this file carries the work. Every step ends green on `pnpm lint && pnpm check-types && pnpm test` and a conventional commit.

**Amendment window.** ADRs 0037–0042 were written for this deliverable (while D3 was still in progress — writing is not opening) and may be amended in place while D4 is in progress, labelled `**Amended YYYY-MM-DD (D4.N).**` at the point of change (ADR-0025 rule 2). **ADRs 0001–0036 are closed** — 0030–0036 shut with D3 on 2026-08-20 — so if the work below needs any of them to say something different, stop and write a superseding ADR (ADR-0024 rule 1). That is the live constraint for this deliverable rather than a formality: D4 rebuilds surfaces ADR-0034 and ADR-0035 describe, and those two are now frozen.

**Gate.** ADRs 0037–0042 are `proposed`, and opening the deliverable did not change that. Each is accepted before its own implementing step starts (ADR-0025 rule 3) — the stricter reading of the precedent D3 set by accepting all seven of its ADRs on one day, and the reason a step below is un-startable until somebody has read its ADR and agreed with it.

## Build order

### ~~1. Grid viewport layout — the shell fixes~~ — **done 2026-08-20**

**ADRs:** [0037](../adr/0037-grid-viewport-layout.md), [0031](../adr/0031-ui-design-system.md), [0032](../adr/0032-admin-app-architecture.md)

First because it fixes what is broken today and builds the frame every later region slots into. The root cause of both shipped defects is one CSS fact — flex items default to `min-width: auto`, and nothing in the chain from `SidebarInset` to the table says otherwise, so the inset is floored at the table's `whitespace-nowrap` min-content width. `min-w-0` lands on `SidebarInset` (an owned edit to `packages/ui`'s generated `sidebar.tsx`, under ADR-0031's regenerate-and-diff model) and on the dashboard page container; the doubled scroll wrapper goes (`@repo/ui`'s `Table` gains the container opt-out; AppGrid owns the one scroll element); grid pages become height-budgeted — static toolbar and filter-bar regions, a `flex-1 min-h-0 overflow-auto` scroll body with a sticky header, the pager as a static footer, a minimum-height floor, and the token-driven thin scrollbar utility from `@repo/ui`.

**Done when:** no page-level horizontal scrollbar at any viewport width with both resource grids rendered; collapsing/expanding the sidebar reflows the grid smoothly through the 200 ms transition; the grid fills the viewport with header and pager static while only rows scroll (custom scrollbars, both engines); a very short viewport degrades to page scroll at the floor rather than a crushed grid; profile and dashboard pages keep normal document flow.

**Closed.** ADR-0037 accepted at the head of the step, then built: `min-w-0` on `SidebarInset` and on the page container, a `container` opt-out on `@repo/ui`'s `Table` so AppGrid owns the one `overflow-auto` element, the flex height budget with a sticky header and a static pager, `min-h-64` as the floor, `.scrollbar-thin` in the design system, and full height as a per-page `staticData` opt-in.

Three things the browser found that neither the class lists nor the MSW tier could, each amended into ADR-0037 rather than worked around: **`min-h-svh` is a floor, not a ceiling**, so the budget needs one definite height (`h-svh` on the inset in full-height mode) or every `flex-1` below it resolves against the content it was meant to clip; **a sticky `thead`'s background does not travel** while `border-collapse: collapse` is in force, so the grid's table draws with separated borders at zero spacing and puts the borders and the opaque background on the cells; and **nothing on the grid path may clip**, because an `overflow-hidden` on the Card ate the pager on a short viewport instead of letting the page scroll.

Evidence, separated the way `D3.10` separated it. **Machine-verified:** `pnpm lint`, `pnpm check-types`, `pnpm format:check` clean; `pnpm test` green at `0 cached, 8 total` — 433 API, 267 admin (+7), 12 `@repo/ui` (+3). **Walked in Chrome against the dev stack**, which is the only tier that can see geometry: both grids viewport-filled with the header and pager static and only rows scrolling; no page-level scrollbar on either axis, in either sidebar state or across the transition; the scroll body flexing from 465px down to its 256px floor as the frame shrinks, and overflowing rather than crushing below roughly 560px; `/profile` and `/` with no height constraint and no pane scroller. **Not walked:** Firefox — the standard `scrollbar-width` / `scrollbar-color` half of the utility is written but only Chrome's rendering was seen.

### 2. Record routes and edit surfaces

**ADRs:** [0040](../adr/0040-record-routes-and-edit-surfaces.md), [0032](../adr/0032-admin-app-architecture.md), [0034](../adr/0034-server-state-and-notifications.md)

Second because it restructures the pages before more grid surface accumulates on them. Form surfaces become routes — `/staff/new`, `/staff/$staffId`, `/users/new`, `/users/$userId` — with list search params retained across open/close, detail data through the route loader (`ensureQueryData`, the first real user of the loader plumbing D3 threaded and left unused), and the three shells behind one config switch: `grid.editSurface: "dialog" | "drawer" | "page"` rendering the same ADR-0035 form in an `AppFormDialog`, a right-side `Sheet`, or a standalone page (grid unmounted). Destructive confirmations (delete, revoke-sessions, bulk delete) and the reset-password ceremony deliberately stay ephemeral component state — a URL must not reopen a "confirm delete".

**Done when:** opening edit puts the record id in the URL for both resources; reload restores the open surface with list state intact; Back closes it; an unknown id shows the error surface, not a blank overlay; flipping a resource's `editSurface` config renders the same form in all three shells with no other change; deep-linking `/users/$id` in a fresh session loads the record.

### 3. Selection, capabilities and the toolbar

**ADRs:** [0038](../adr/0038-grid-selection-and-capabilities.md), [0042](../adr/0042-client-side-authorization.md), [0028](../adr/0028-account-deletion.md), [0034](../adr/0034-server-state-and-notifications.md)

`ResourceConfig` gains the `grid` capability block (`selectable`, `canCreate`, `canEdit`, `canDelete`, `canBulkDelete`); AppGrid registers the v9 row-selection feature and injects the checkbox column when selected-for; `GridToolbar` becomes a real region — search left, capability-driven actions right (Create moves in from the page's `CardAction`, wired to the `new` route from D4.2), with `toolbarStart` / `toolbarEnd` / `renderToolbar` as the JSX extension seams. Bulk delete is a feature-owned `Promise.allSettled` fan-out over the existing per-row deletes: one confirmation with honest per-resource copy, one invalidation, one summary toast with per-item refusals (the ADR-0028 rules — rank, last super admin, self-delete — surface per item, which is the semantic a transactional endpoint could not give).

[ADR-0042](../adr/0042-client-side-authorization.md) lands with it, because the two answer different halves of the same question and shipping one without the other reproduces the defect that motivated both: a capability says _this surface offers the action_, `can(action, resource)` says _this operator's role may perform it_, and an affordance needs both. `shared/auth` gains the policy table and the predicate; the narrowing is applied once per screen so `shared/grid` never learns a resource name. This is the D3.8 deferral — a `manager` reaching `/admin/users` and being refused by every write it offers — answered at the layer that draws the affordances. **Answered, not eliminated**: ADR-0042 deliberately leaves the containment actions (reset password, sign out everywhere, and edit while disabling lives inside it) rendering for everyone, because a hidden break-glass control during an incident is worse than a refused one. Two of the five affordances disappear for a `manager`; the other three still `403`, on purpose, and the ADR says why.

**Done when:** selection is keyed by row id and survives page and filter navigation; the header checkbox toggles the current page and the count reads "N selected" across pages; capability flags provably add/remove the toolbar buttons and row-menu items; a `manager` is offered neither Create nor Delete on `/admin/users` while an `admin` is offered both, and the three containment actions render for both because ADR-0042 refuses to hide them — neither assertion is a security claim, the API still answers; a mixed bulk delete (some refused) reports both outcomes and leaves the grid consistent after one refetch; toolbar slots append and `renderToolbar` replaces.

### 4. Filter UX — dialogs, hot filters and the applied-filters bar

**ADRs:** [0039](../adr/0039-grid-filter-ux.md), [0014](../adr/0014-pagination-filtering-sorting.md), [0034](../adr/0034-server-state-and-notifications.md)

The filter row dies. Filterable columns get a header filter icon (active state when applied) opening a per-column dialog that reuses the four existing control kinds — text, enum, dateRange, presence — with explicit Apply/Clear. Resources may declare **hot filters** (`grid.hotFilters`): toolbar button groups for the stance-like filters — staff status, role, "deleted only" — one press to apply, one to release, writing through the same `withFilters` channel and tested against the same contract allow-lists. Above the table, the applied-filters bar renders one removable chip per applied filter plus `q`, and Clear all; the bar reads the URL's validated filters, **not** the column configs, so a deep-linked filter on a field no column owns still shows and clears — the same lesson `withFilters`' `owned` argument already encodes — while a chip currently displayed by a pressed hot-filter button is suppressed, keeping every filter visible and removable in exactly one place. ADR-0014's operator allow-list is the unmoved boundary: no dialog or button offers an operation the contract cannot answer.

**Done when:** no always-visible filter row remains and dateRange columns return to content width; each filter kind round-trips through its dialog (Apply commits, Clear removes, the icon's active state tracks the URL); a declared hot-filter group renders, presses on and off, agrees with the same field's header dialog, and is cleared by Clear all; a deep-linked unowned filter renders a chip and is clearable; Clear all resets filters and `q`, returns to offset 0, and leaves sort and limit alone; all asserted in the MSW tier.

### 5. Persisted grid preferences

**ADRs:** [0041](../adr/0041-grid-preferences.md), [0033](../adr/0033-browser-api-client-and-session.md), [0032](../adr/0032-admin-app-architecture.md)

The third state owner, with its boundary written down: the URL owns view state, preferences own ergonomics. Column sizing (header-edge drag), order and visibility (the "Columns" toolbar menu with reset) land as controlled v9 feature state backed by `createGridPreferences({ gridId, storage })` — a closure-based store over a storage-adapter seam, `localStorage` adapter now, the future user-settings API later without touching AppGrid. Values are versioned, zod-validated on read (corrupt → silently discarded), and reconciled against the current config (vanished columns dropped, new ones appended at defaults). The `actions` and selection columns are exempt from hiding and reordering by construction.

**Done when:** resize, reorder and hide/show each persist across a reload, independently per grid (`staff` and `users` prove isolation); a corrupted or stale-versioned stored value falls back to config defaults without an error; removing a column from config strands nothing; Reset returns to config defaults; nothing but column names and numbers ever enters storage.

### 6. The sweep — both resources on the full v2 surface

**ADRs:** all of 0037–0042

Staff and users both run the complete v2 grid: capabilities declared per resource (users: `editSurface` other than staff's, to prove the switch; staff: bulk delete exercised against the rank-rule refusals), the machinery diff-check from D3.8 repeated — the step's deliverable is that enabling v2 for the second resource is config plus thin wiring, no change under `shared/`. Where it is not thin, the finding goes to the ADR's amendment, not to a workaround. Docs sync: `frontend-conventions` and the `new-resource-ui` checklist (both landed in D3.10) gain the capability block, edit-surface choice, and preferences.

**Done when:** both resource grids expose the full surface; the step's diff contains no change under `shared/`; a manual walk of every D4 behaviour against the dev API succeeds on both resources.

### 7. Close-out

**ADRs:** [0025](../adr/0025-deliverables.md) rule 4

- Fill the _Implemented_ column in `docs/adr/README.md` for ADRs 0037–0041 in `D4.N` form.
- Sync `CLAUDE.md` (the frontend non-negotiables bullet gains capabilities, edit surfaces, preferences) and anything else the steps changed.
- Run the acceptance checklist below on a fresh clone.
- Move the D4 row in `docs/plan/README.md` to `shipped YYYY-MM-DD`, which shuts the amendment window on ADRs 0037–0041.

## Definition of done

D4 is closed when every step above is closed and this checklist passes on a fresh clone:

1. `pnpm i && cp .env.example .env && pnpm docker:up && pnpm db:setup && pnpm db:seed -- --dev`; `pnpm dev --filter api` and `pnpm dev --filter admin`; sign in as the seeded super admin.
2. `pnpm lint && pnpm check-types && pnpm test` green; `pnpm test:unit` twice hits cache the second time, admin's suites included; `git status` clean after the gates.
3. **Layout walk:** no page-level horizontal scrollbar anywhere; sidebar collapse/expand reflows the grid smoothly; grid fills the viewport — header and pager static, rows scrolling in their own styled scrollbar — and degrades to page scroll below the floor.
4. **Grid walk, both resources:** select rows across two pages and bulk-delete with at least one refusal in the batch — the summary reports both outcomes; filter through the header dialogs (text, enum, date range, presence), watch the icons activate and chips appear, remove one chip, Clear all; press a hot filter on and off and confirm it agrees with the same field's header dialog and vanishes on Clear all; resize, reorder and hide columns, reload, and find them persisted per grid.
5. **Routes walk:** open a record — the id is in the URL; reload restores it; Back closes it; flip `editSurface` across dialog, drawer and page for one resource and repeat; a deep link to a record in a fresh browser session lands on the loaded surface after bootstrap.
6. `pnpm test:postman` green, untouched — D4 changed no API surface.
