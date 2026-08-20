# ADR-0039: Filter UX — header filter dialogs, hot filters and the applied-filters bar

- Status: accepted
- Date: 2026-08-20

> One of the D4 (data grid v2) decision set, written together with [ADR-0037](0037-grid-viewport-layout.md), [ADR-0038](0038-grid-selection-and-capabilities.md), [ADR-0040](0040-record-routes-and-edit-surfaces.md) and [ADR-0041](0041-grid-preferences.md), before D4 opens (`docs/plan/0004-data-grid-v2.md`, `planned` — it opens when D3 ships). `D4.4` is the planned implementing step. Under ADR-0025 it becomes amendable in place while D4 is `in progress`. **Accepted 2026-08-20**, at the head of `D4.4` — the per-step acceptance D4 runs on.

## Context

Filtering in the D3 grid renders as a **second row inside `TableHeader`** — `data-slot="grid-filters"`, one cell per column, a control wherever the column's config declares a `filter`. The row was the D3.6 resolution of ADR-0035's split-brain bullet list ("every filter control renders in the grid's own filter row; the toolbar carries `q` alone"), and it came with its own carefully-argued detail: its cells are `td` rather than `th`, because a `th` would claim the `columnheader` role for cells that label nothing and tell a screen reader a six-column table has twelve headers.

The machinery under the row is sound and this ADR keeps all of it. Four control kinds exist in `shared/grid/filter-controls.tsx`, each a discriminated member of `FilterControlConfig` (`shared/resource/types.ts`): `text` (a 300ms-debounced input writing `eq`, or `like` with the operator's term escaped before wrapping in `%…%`), `enum` (a single `Select` with an `__any__` sentinel), `dateRange` (two date inputs writing `gte`+`lte` on one field, the upper bound pushed to end-of-day), and `presence` (a checkbox writing `filter[field][null]`; its only consumer is the users grid's `deletedAt`, labelled "Deleted only" because it is a scope switch, not an additive filter — ADR-0035, D3.8 amendment). The URL is the only filter state (ADR-0034): a control change flows `onColumnFiltersChange → fromColumnFiltersState → withFilters(state, owned, next)`, and the `owned` argument is a D3.6 lesson worth restating because this ADR builds on it — **the update replaces only the filters that grid columns own**, so a deep-linked filter on a field no column declares (the "deleted only" state arriving by URL on a page whose overrides hid the column, or any future toolbar-written filter) is never erased by touching an unrelated control.

What does not work is the **surface**:

- **The row is always visible, so every column pays its widest filter's width.** A `dateRange` control is two date inputs side by side; the "Created" and "Last login" columns are sized by their filter row, not by their content, and the whole grid reads wider and busier than its data. This is the concrete complaint driving the ADR.
- **There is no summary of what is applied.** An operator on a filtered, searched, page-3 view has to read five controls and a search box to answer "what am I looking at?" — and a filter carried by a deep link on a field with no visible control (exactly the case `owned` protects) is answered by *nothing on screen at all*: the grid shows fewer rows than expected and no UI admits why.
- **There is no clear-all**, so undoing a composed view means visiting each control in turn.

ADR-0037 gives the D4 grid a viewport shell with static regions above the scrolling table, and ADR-0038 gives it a toolbar; the space for an applied-state summary now exists. What must *not* move is the boundary underneath: ADR-0014's operator allow-list (`FILTER_OPS`: `eq`, `in`, `gt`, `gte`, `lt`, `lte`, `like`, `null` — there is no negation operator) remains the outer limit of what any filter UI may offer, and ADR-0035's honesty rules — a control exists only where the contract allow-lists the field and the operators, verified by the config-versus-contract tests — remain the inner discipline.

## Decision

### The filter row is removed

**Delete the second `TableHeader` row.** The grid's header returns to one row of real column headers, and every column is sized by its header and its cells — the `dateRange` columns return to content width. The D3.6 `td`-not-`th` finding dies with the row it patched: with no control cells in the `thead` there is nothing left to mis-role, and the finding's *lesson* (cells that label nothing must not claim `columnheader`) stands recorded in ADR-0035 for whoever next puts a control in a header.

### A filter icon in the header; a dialog to compose in

**Columns whose config declares a `filter` render a filter icon button in their header, next to the existing sort control.** Sorting is untouched: a header/sort-icon click toggles sort exactly as today. The filter button:

- renders **only** where `ColumnConfig.filter` is declared — which, by ADR-0035's standing rule, is only where `listQuerySchema` allow-lists the field and the operators, so the icon inherits the honesty the row had;
- carries `aria-label` `"Filter by <header>"` (the same accessible name the row's controls used);
- is visually **active** — filled/accent — when the URL currently carries a filter on that column's field, with the same state exposed to assistive technology, so a glance at the header answers "is this column filtered?" without opening anything.

**Amended 2026-08-20 (D4.4): the active state travels *in* the accessible name, because on this control there is nowhere else honest to put it.** The two bullets above ask for both — a name pinned to `"Filter by <header>"`, and the state exposed to assistive technology — and the implementation could not have both. `aria-pressed` was the obvious channel and is the wrong one: it declares a toggle button, and this button toggles nothing, it opens a dialog. `data-active` is what the accent colour reads and a screen reader never hears. So the name is `"Filter by <header>"` when the column is clear and `"Filter by <header> (filtered)"` when the URL carries a filter on it, which is the sentence a screen-reader user needs and the only one this control can carry. Tests name it by prefix.

**The button opens a shadcn `Dialog` carrying that column's filter UI by kind.** The four control kinds and their operator mappings are **reused as dialog content, not redesigned**: `text` renders its input with the op made visible (e.g. "contains" for `like`; the `%`/`_`/`\` escaping rule is unchanged), `enum` its select, `dateRange` its from/to pair, `presence` its labelled toggle. Focus trapping, `Escape`, and return-of-focus come free with the Dialog primitive (ADR-0031) — none of it is rebuilt here.

**The dialog commits on an explicit Apply.** It has two actions:

- **Apply** — translate the draft through the existing `toListFilters` mapping and navigate once, via `withFilters` with the same `owned` semantics as today.
- **Clear** — remove only *this column's* filters (both halves of a range) and navigate.

A dialog is a **composition surface**: an operator setting a date range types two values, and live-committing after the first would refetch a half-meant query — the filter row's per-keystroke debounce trick does not transfer to a range, where "half done" is not "almost right" but a different question. Committing on Apply makes one navigation carry one intent.

One boundary is deliberately left open: this ADR does not forbid a later anchored-popover *presentation* of the same dialog content — the decision that is load-bearing is **icon-triggered, per-column, on-demand** rather than always-visible, not the choice of overlay primitive. §Alternatives records why the dialog was chosen first.

### The applied-filters bar

**A bar above the table — between ADR-0038's toolbar and the header, a static region in ADR-0037's shell — renders one removable chip per applied filter, plus a chip for an active `q`, plus a Clear-all action.** It renders nothing (no dead band) when there is nothing applied.

**Amended 2026-08-20 (D4.4): "nothing applied" is a fact about the URL, not about the chips.** Once hot filters suppress the chips they display, the two stop being the same count — a grid with a pressed "Deleted only" and nothing else has zero chips and one applied filter, and a bar that rendered on chip count would take Clear all off screen exactly when it was the only way to release the stance. The bar renders whenever `filters` is non-empty or `q` is set; sometimes that is a Clear all with no chips beside it, which is correct.

**The load-bearing rule: the bar renders from the URL's validated `listState.filters` (plus `q`) — never from the column configs.** This is the same lesson `withFilters`' `owned` argument encodes, applied to display instead of update: a deep-linked or otherwise foreign filter on a field no column owns *was actually sent to the server*, and a summary derived from configs would omit it — a grid silently narrower than its UI admits. The bar is the honest display of what the server was asked. Column configs contribute **labels only, never membership**: where a column owns the field, the chip reads header + human operator + value (enum values resolved through the config's `options`, a `presence` chip using the config's own label — "Deleted only", not a boolean); where no column owns it, the chip falls back to a raw `field op value` rendering, which is ugly on purpose — it is showing the operator something no config claimed to understand, and it must still be removable.

```ts
// apps/admin/src/shared/grid/filter-chips.ts — pure, unit-tested (ADR-0036)
export interface FilterChip {
  readonly key: string;    // field + op — stable identity for React and tests
  readonly label: string;  // "Created from 1 Jan 2026" | "Deleted only" | raw "x gte y"
  readonly filter: Filter; // exactly what removing the chip removes
}

export const chipsForState = (
  filters: readonly Filter[],
  columns: readonly (readonly [string, ColumnConfig])[], // labels only, never membership
): readonly FilterChip[] => { /* one chip per Filter, labelled where owned */ };

// apps/admin/src/shared/grid/list-state.ts — beside withFilters, same conventions
export const withoutFilter = (
  state: ListQuerySearch,
  filter: Filter,
): ListQuerySearch => { /* drop that field+op entry; back to offset 0 */ };

export const clearedFilters = (
  state: ListQuerySearch,
): ListQuerySearch => { /* drop filters and q, offset 0; sort and limit stand */ };
```

One chip per applied `Filter` means a date range shows two chips (from and to), each independently removable — which matches what the URL and `meta.filters` actually hold, and lets an operator loosen one bound without re-composing the other. **Removing a chip removes that filter; Clear all clears filters and `q`, resets `offset` to 0, and leaves `sort` and `limit` alone** — what is *listed* changed, so the page resets (the standing `atFirstPage` rule); how it is ordered and sized did not.

### Hot filters — the same model, one press away

Some filters are not compositions but *stances* — "active staff", "editors", "deleted only" — pressed and released many times a session. Forcing them through a header dialog taxes the most-used filters with the ceremony built for the least-used ones. So a resource may declare **hot filters**: button groups rendered in the toolbar (ADR-0038's left cluster, after `GridSearch`), one press to apply, one press to clear.

**Hot filters are declared in config and are nothing but a third writer of the same state.** `ResourceConfig.grid` (ADR-0038's block) gains `hotFilters?: readonly HotFilterConfig[]` — serializable data, per resource, optional; a grid that declares none renders none, which is the whole of "pluggable":

```ts
// shared/resource/types.ts — mirrors FilterControlConfig's discriminated style
export type HotFilterConfig =
  | { readonly kind: "enum"; readonly field: string; readonly label: string;
      readonly op: "eq" | "in"; readonly options: readonly OptionConfig[] }
  | { readonly kind: "presence"; readonly field: string; readonly label: string;
      readonly op: "null"; readonly value: boolean };

// entities/staff/staff.config.ts
grid: {
  hotFilters: [
    { kind: "enum", field: "status", label: "Status", op: "eq", options: STAFF_STATUSES },
  ],
},
```

**Amended 2026-08-20 (D4.4), on both halves of that snippet.**

**`kind`, not `control`.** The comment above the type says it mirrors `FilterControlConfig`'s discriminated style and the code then picks a different discriminant name. Two words for one idea, in one file, is the sort of thing nobody remembers which side of; `kind` is what the sibling union uses and what every `switch` in `shared/grid` already reads.

**And `roles` cannot be a staff hot filter.** `listStaffQuery.filterable` has no `roles` entry — `staff_roles` is a join table, which §Context of this very ADR says about the *columns* and then forgets one screen later. The example was written from what a resource looks like rather than from what its contract allows, which is the exact failure the honesty rule exists for. It is not a slip that survives contact: the config-versus-contract tests §Hot filters promises were written first, and this ADR's own example is the first thing they refused. `status` alone is what staff declares; the users grid declares `status` and the `presence` toggle §Consequences anticipates.

- **Two kinds, deliberately.** `enum` renders a button group — `op: "eq"` as a segmented single-select with an implicit "All" (pressing the active option releases it), `op: "in"` as multi-toggle buttons accumulating into one `filter[field][in]`. `presence` renders a single toggle ("Deleted only"). `text` and `dateRange` are excluded on purpose: a button is a *choice*, not a composition surface — those kinds belong to the dialogs above.
- **The same model, verbatim.** A press translates to the same `Filter` shape and navigates through `withFilters` with the hot filter's own field as `owned` — no second channel, no new helpers. Pressed state derives from the URL's validated filters, so a hot filter and a header dialog on the same field cannot disagree: they are two views of one entry, and either surface's change is instantly reflected in the other.
- **The same honesty.** A hot filter may be declared only where `listQuerySchema` allow-lists the field and operator, and the config-versus-contract tests (ADR-0035/0036) extend to `hotFilters` exactly as they cover column filters — a button the API would refuse fails a test before it fails an operator.
- **Chips defer to a pressed button.** The applied-filters bar suppresses a chip whose filter a hot-filter control currently *displays* — the pressed button is that filter's visible, removable representation, and two removal affordances for one entry is noise. The invariant the bar keeps is unchanged in spirit: **every applied filter is visible and removable in exactly one place.** A deep-linked value the group cannot represent (a `status` outside the declared options, a foreign field) gets its chip as before, and **Clear all clears hot filters too** — they are filters, not a separate mechanism.

  **Amended 2026-08-20 (D4.4): "displays" is all-or-nothing, and it is defined as "could pressing these buttons have produced exactly this?"** Any looser reading breaks the invariant it is meant to keep. A multi-toggle `in` group holding `["alpha", "gamma"]` where only `alpha` is declared must not press `alpha` and call the entry displayed: half of what the server was asked would then be represented by nothing at all — a filter the operator can neither see nor remove, which is the failure this whole ADR opens on. So a group whose value it cannot fully represent shows **nothing** pressed and hands the entry to the chips bar, which can render anything. The same rule makes an operator mismatch (an `eq` group against an `in` filter) and an inverted presence value (`null: true` against a toggle declaring `null: false`) chips rather than presses.

  **And suppression is by *entry*, not by resemblance.** A predicate asking "could pressing these buttons have produced this filter?" is right about a filter and wrong about a *list* of them: the group renders from the first `field:op` entry it finds, so a URL carrying `status eq active` and `status eq disabled` presses "Active" while the predicate suppresses both — the second entry invisible and unremovable, which is this invariant failing inside the code that keeps it. The bar suppresses the entries the groups actually read, which cannot say that whatever the URL holds.

  **And nothing is suppressed when the toolbar was replaced.** ADR-0038's `renderToolbar` replaces the region outright, hot filters included — so `AppGrid` passes the bar an empty list in that case. Suppressing a chip because a control that is not on screen would have displayed it is the silently-narrower grid arriving through the extension seam.
- **Not a capability** (added 2026-08-20, `D4.4`). `hotFilters` sits on `GridConfig` beside ADR-0040's `editSurface`, deliberately outside ADR-0038's `GridCapabilities` block, and reaches `AppGrid` as its own prop rather than through `allowedCapabilities`. The capability block is the thing ADR-0042 narrows by role, and narrowing a filter by role would be meaningless: nobody's role decides whether a list may be looked at through a smaller window, and the rows the filter admits are the rows the API was already willing to send. A hot filter is declared filter surface, like a column.
- **The escape hatch is the toolbar slot.** A one-off control too custom for the config vocabulary composes `withFilters` by hand inside ADR-0038's `toolbarStart` — the same division ADR-0035 draws everywhere: config for the declarable, JSX for the bespoke.

### One source, announced

The filter icons' active states, the hot filters' pressed states, the chips, and the dialogs' initial drafts all derive from the same single source — the URL's validated list state — so they cannot disagree with each other or with the request the server answered. The bar's region announces its changes politely (`aria-live="polite"`), so applying or clearing a filter is heard, not only seen; the wording is a `D4.4` implementation detail.

**Settled at `D4.4`, since it was left here to be.** The live region is a visually hidden `role="status"` holding a count — "3 filters applied" — rather than `aria-live` on the chip list itself, which would read every added and removed chip aloud in sequence and turn Clear all into a recital. One polite sentence per change, with wording chosen rather than inherited from a DOM diff.

**Amended 2026-08-20 (D4.4): a hot-filter group is named `"<label> filter"`, not `<label>`.** A group called "Status" is indistinguishable from the *form field* called "Status" the moment a record surface opens over the grid — which ADR-0040 makes the normal case, since the grid stays mounted underneath — so both are in the document at once and a label query finds two things. Naming what the control *is*, not only what it is about, fixes that and is also what a screen reader needs on landing in a toolbar out of context.

### What this does not change

- **ADR-0014's operator allow-list is the boundary of offerable UI.** `FILTER_OPS` has no negation — no "not contains", no "not equals", no "not in" — so no filter dialog may offer one, however natural it looks next to "contains". Adding a negation operator is a supersession of ADR-0014 (D1, frozen since 2026-08-18) with API, contracts and repository work behind it; it belongs on the index's Planned list, not in this deliverable, and until then the UI's vocabulary ends where the contract's does.
- **The `owned`-replacement semantics of `withFilters`, the `like`-escaping rule, and URL-as-single-owner (ADR-0034)** all stand unchanged. The dialogs write through the same translation layer the row wrote through.
- **ADR-0035's honesty rules and operator mappings.** That ADR decided "per-column filter controls exist wherever they can be honest", and its config-versus-contract tests keep that true; this ADR re-houses the control *surface* — from an always-visible row to on-demand dialogs plus a summary bar — without touching what a control is, which operators it writes, or where one may exist. On acceptance, this ADR replaces the *placement* half of ADR-0035's D3.6 amendment (the filter row); everything else in that amendment, including `q` staying in the toolbar because it is a property of the endpoint rather than of any column, stands.

## Consequences

- **`dateRange` columns return to content width** — the direct fix for the complaint that opened this ADR — and every grid loses a permanent band of mostly-empty controls.
- **A filtered view finally explains itself.** The chips answer "what am I looking at?" in one line, including for state no visible control produced, and Clear all undoes a composed view in one action.
- **One more dialog surface** living under the app's existing overlay conventions (submit-lock posture, focus management per ADR-0031/0035); the Dialog primitive supplies the behaviour, so this is composition rather than new machinery.
- **The chips bar is the first UI rendered from *foreign* state**, which is new test surface (ADR-0036): a deep-linked filter on an unowned field shows a raw-labelled chip and removing it navigates correctly; an icon's active state matches the URL; Apply commits one navigation and Clear removes only its column; Clear all drops filters and `q`, resets the offset, and preserves sort and limit. `chipsForState`, `withoutFilter` and `clearedFilters` are pure and unit-testable beside the existing `list-state` and `column-filters` suites.

  **Amended 2026-08-20 (D4.4): "foreign state" turned out to include state this app wrote, and the security pass is what found it.** Three ways the bar could describe a filter differently from the request it stands for, all of them in the labelling and none in the plumbing:

  - **A `like` chip may only say "contains" about a pattern `containsPattern` produced.** `unescapeContains` is a *lossy* inverse — exact for what this UI writes, a guess for anything else. A deep link carrying `like: "ada"` with no wrapping `%` asks for an exact match; unwrapping it would put "Email contains “ada”" above an empty grid and let an operator conclude the substring is missing rather than that they asked a different question. `like: "%a%b%"` runs the other way, rendering a wildcard as a literal `%`. The term is therefore round-tripped through `containsPattern` and trusted only if it reproduces the pattern exactly; otherwise the chip falls through to the raw form, which is what this ADR already prescribes for anything it cannot honestly phrase. (The dialog's *draft* is seeded by the same lossy inverse and is left as it was: that path ends in an explicit Apply, so the rewrite is something the operator does rather than something that happens to them. Recorded, not fixed.)
  - **A range chip names a UTC day, not a local one.** `toListFilters` builds a bound as UTC midnight or UTC end-of-day of the day picked in a `<input type="date">`, and the dialog re-reads it with `toISOString().slice(0, 10)`. Formatting that instant with the *cell* formatter — correctly local, because a cell holds a real event — moves an end-of-day bound forward a day east of UTC and a start-of-day bound back a day west of it, so the chip and the dialog name different days for one filter. A bound is not an event; it is the day that was typed.
  - **`filterSchema` bounds neither `field` nor a scalar `value`**, which was harmless while nothing rendered a filter no column owned and stopped being harmless the moment this bar did. Labels are clamped, because an unbounded one wraps into a band that eats ADR-0037's height budget and pushes the table and pager off screen. Bounding the schema itself is the better fix and is a `@repo/contracts` change this deliverable does not take; it is recorded on the index's Planned list.

  A fourth was in the suppression rule rather than in a label, and is amended at §Hot filters instead: suppression is by filter *entry*, not by resemblance.
- **The code mostly moves house rather than being rewritten.** The dialog content is the existing `FilterControl` kinds, the translations (`toListFilters`, `toColumnFilterValue`, `containsPattern` and its inverse) are untouched, and the removal helpers are siblings of `withFilters`. The row's per-keystroke debounce becomes unnecessary inside a commit-on-Apply dialog — a deletion, not a redesign.
- **Filtering costs one more click than the row did — except where it costs none.** An operator who filtered the same column constantly paid nothing before and pays an icon-click now; where that cost matters, the resource declares a hot filter and the stance is one press. The row taxed *every* grid's width and legibility all the time; the dialog-plus-hot-filter split prices each filter by how it is actually used.
- **Hot filters add a config vocabulary and a suppression rule to test** (ADR-0036): a declared group renders and round-trips through the URL; pressing the active `eq` option releases it; a chip is suppressed exactly while a button displays its filter and reappears for unrepresentable values; Clear all releases pressed buttons. The users grid's "Deleted only" is expected to become the first `presence` hot filter — the D4.6 sweep decides whether the `deletedAt` column keeps a duplicate dialog control or drops it.

  **Amended 2026-08-21 (D4.6): it drops it.** `D4.4` made "Deleted only" a toolbar stance and left the `deletedAt` column's `presence` control in place, so one filter had two controls three inches apart — and the chip-suppression rule, which exists to keep every applied filter removable in *exactly one place*, was quietly doing that job for a bar while the header and the toolbar both offered the switch. What this deletes is the exact control frozen [ADR-0035](0035-config-driven-resource-ui.md)'s D3.8 amendment argues about — the "Deleted only" label and the scope-switch reasoning behind it — so that paragraph now describes a control the toolbar owns rather than a column. The column keeps its place, because it is not the filter: a soft-deleted account is listed like any other and reports `status: "disabled"` (ADR-0028), so the timestamp is the only thing on the row that says which of the two it is. What it loses is the second control. The consequence worth stating: **`presence` now has no live consumer among the real column configs** — it survives as a `FilterControlConfig` kind exercised by the demo fixture and by the hot-filter vocabulary, and the day a resource wants a nullability question in a header dialog rather than in the toolbar, the kind is there.

## Alternatives considered

- **Keep the always-visible filter row.** The status quo, and the complaint: every column pays its widest filter's width (`dateRange` proves it), the header area carries controls whether or not anyone is filtering, and the row still offers no summary, no clear-all, and no account of foreign filters. The row also required its own accessibility patch (`td` in a `thead`) to avoid mis-rolling; the on-demand design has nothing in the header but headers.
- **Popover instead of dialog.** Anchored to the icon, arguably lighter UX for a one-field edit, and the shadcn idiom for header menus. The dialog was the explicit product decision, and it holds on its merits: it serves small screens without a second code path (a popover needs a mobile fallback; a dialog *is* one), and the content — a labelled form, sometimes two dates and two buttons — is a form, not a menu. The door stays open (§Decision): a later popover presentation of the same content would change the overlay, not the decision.
- **A single "all filters" panel editing every column at once.** One surface, but it loses the spatial tie between a filter and its column — the thing the header icon preserves from the row — and the bar plus per-column dialogs already compose to the same capability: see everything applied, change any one thing.
- **Faceted-filter buttons in the toolbar for every filterable column.** shadcn's own data-table idiom. It scales badly past about three filterable columns (the users grid has five), turns the toolbar into a second header, and duplicates the spatial anchoring the real header already provides. §Hot filters is the deliberate, bounded version of this idea: toolbar buttons for the two or three filters a resource *names* as stances, not for every filterable column by default.
- **Hot filters as ad-hoc page components instead of config.** Each page composing its own button group over `withFilters` — workable, and it is exactly the escape hatch kept for the bespoke case. Rejected as the default because the declarable case is the common one, and config is what makes a hot filter one line in the resource, tested against the contract, instead of a copy-pasted component drifting per page.
- **Live-commit inside the dialog.** Symmetry with the row's behaviour, but the row's debounce trick does not transfer: a half-typed range is a different query, not a nearly-right one, and live-committing it refetches garbage between the two halves of the operator's intent. Apply makes one navigation carry one meaning, and it is what the explicit Clear pairs with.
