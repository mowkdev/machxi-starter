# ADR-0039: Filter UX — header filter dialogs, hot filters and the applied-filters bar

- Status: proposed
- Date: 2026-08-20

> One of the D4 (data grid v2) decision set, written together with [ADR-0037](0037-grid-viewport-layout.md), [ADR-0038](0038-grid-selection-and-capabilities.md), [ADR-0040](0040-record-routes-and-edit-surfaces.md) and [ADR-0041](0041-grid-preferences.md), before D4 opens (`docs/plan/0004-data-grid-v2.md`, `planned` — it opens when D3 ships). `D4.4` is the planned implementing step. Under ADR-0025 it becomes amendable in place while D4 is `in progress`.

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

**The button opens a shadcn `Dialog` carrying that column's filter UI by kind.** The four control kinds and their operator mappings are **reused as dialog content, not redesigned**: `text` renders its input with the op made visible (e.g. "contains" for `like`; the `%`/`_`/`\` escaping rule is unchanged), `enum` its select, `dateRange` its from/to pair, `presence` its labelled toggle. Focus trapping, `Escape`, and return-of-focus come free with the Dialog primitive (ADR-0031) — none of it is rebuilt here.

**The dialog commits on an explicit Apply.** It has two actions:

- **Apply** — translate the draft through the existing `toListFilters` mapping and navigate once, via `withFilters` with the same `owned` semantics as today.
- **Clear** — remove only *this column's* filters (both halves of a range) and navigate.

A dialog is a **composition surface**: an operator setting a date range types two values, and live-committing after the first would refetch a half-meant query — the filter row's per-keystroke debounce trick does not transfer to a range, where "half done" is not "almost right" but a different question. Committing on Apply makes one navigation carry one intent.

One boundary is deliberately left open: this ADR does not forbid a later anchored-popover *presentation* of the same dialog content — the decision that is load-bearing is **icon-triggered, per-column, on-demand** rather than always-visible, not the choice of overlay primitive. §Alternatives records why the dialog was chosen first.

### The applied-filters bar

**A bar above the table — between ADR-0038's toolbar and the header, a static region in ADR-0037's shell — renders one removable chip per applied filter, plus a chip for an active `q`, plus a Clear-all action.** It renders nothing (no dead band) when there is nothing applied.

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
  | { readonly field: string; readonly label: string; readonly control: "enum";
      readonly op: "eq" | "in"; readonly options: readonly Option[] }
  | { readonly field: string; readonly label: string; readonly control: "presence";
      readonly op: "null"; readonly value: boolean };

// entities/staff/staff.config.ts
grid: {
  hotFilters: [
    { field: "status", label: "Status", control: "enum", op: "eq", options: STAFF_STATUSES },
    { field: "roles",  label: "Role",   control: "enum", op: "eq", options: STAFF_ROLES },
  ],
},
```

- **Two kinds, deliberately.** `enum` renders a button group — `op: "eq"` as a segmented single-select with an implicit "All" (pressing the active option releases it), `op: "in"` as multi-toggle buttons accumulating into one `filter[field][in]`. `presence` renders a single toggle ("Deleted only"). `text` and `dateRange` are excluded on purpose: a button is a *choice*, not a composition surface — those kinds belong to the dialogs above.
- **The same model, verbatim.** A press translates to the same `Filter` shape and navigates through `withFilters` with the hot filter's own field as `owned` — no second channel, no new helpers. Pressed state derives from the URL's validated filters, so a hot filter and a header dialog on the same field cannot disagree: they are two views of one entry, and either surface's change is instantly reflected in the other.
- **The same honesty.** A hot filter may be declared only where `listQuerySchema` allow-lists the field and operator, and the config-versus-contract tests (ADR-0035/0036) extend to `hotFilters` exactly as they cover column filters — a button the API would refuse fails a test before it fails an operator.
- **Chips defer to a pressed button.** The applied-filters bar suppresses a chip whose filter a hot-filter control currently *displays* — the pressed button is that filter's visible, removable representation, and two removal affordances for one entry is noise. The invariant the bar keeps is unchanged in spirit: **every applied filter is visible and removable in exactly one place.** A deep-linked value the group cannot represent (a `status` outside the declared options, a foreign field) gets its chip as before, and **Clear all clears hot filters too** — they are filters, not a separate mechanism.
- **The escape hatch is the toolbar slot.** A one-off control too custom for the config vocabulary composes `withFilters` by hand inside ADR-0038's `toolbarStart` — the same division ADR-0035 draws everywhere: config for the declarable, JSX for the bespoke.

### One source, announced

The filter icons' active states, the hot filters' pressed states, the chips, and the dialogs' initial drafts all derive from the same single source — the URL's validated list state — so they cannot disagree with each other or with the request the server answered. The bar's region announces its changes politely (`aria-live="polite"`), so applying or clearing a filter is heard, not only seen; the wording is a `D4.4` implementation detail.

### What this does not change

- **ADR-0014's operator allow-list is the boundary of offerable UI.** `FILTER_OPS` has no negation — no "not contains", no "not equals", no "not in" — so no filter dialog may offer one, however natural it looks next to "contains". Adding a negation operator is a supersession of ADR-0014 (D1, frozen since 2026-08-18) with API, contracts and repository work behind it; it belongs on the index's Planned list, not in this deliverable, and until then the UI's vocabulary ends where the contract's does.
- **The `owned`-replacement semantics of `withFilters`, the `like`-escaping rule, and URL-as-single-owner (ADR-0034)** all stand unchanged. The dialogs write through the same translation layer the row wrote through.
- **ADR-0035's honesty rules and operator mappings.** That ADR decided "per-column filter controls exist wherever they can be honest", and its config-versus-contract tests keep that true; this ADR re-houses the control *surface* — from an always-visible row to on-demand dialogs plus a summary bar — without touching what a control is, which operators it writes, or where one may exist. On acceptance, this ADR replaces the *placement* half of ADR-0035's D3.6 amendment (the filter row); everything else in that amendment, including `q` staying in the toolbar because it is a property of the endpoint rather than of any column, stands.

## Consequences

- **`dateRange` columns return to content width** — the direct fix for the complaint that opened this ADR — and every grid loses a permanent band of mostly-empty controls.
- **A filtered view finally explains itself.** The chips answer "what am I looking at?" in one line, including for state no visible control produced, and Clear all undoes a composed view in one action.
- **One more dialog surface** living under the app's existing overlay conventions (submit-lock posture, focus management per ADR-0031/0035); the Dialog primitive supplies the behaviour, so this is composition rather than new machinery.
- **The chips bar is the first UI rendered from *foreign* state**, which is new test surface (ADR-0036): a deep-linked filter on an unowned field shows a raw-labelled chip and removing it navigates correctly; an icon's active state matches the URL; Apply commits one navigation and Clear removes only its column; Clear all drops filters and `q`, resets the offset, and preserves sort and limit. `chipsForState`, `withoutFilter` and `clearedFilters` are pure and unit-testable beside the existing `list-state` and `column-filters` suites.
- **The code mostly moves house rather than being rewritten.** The dialog content is the existing `FilterControl` kinds, the translations (`toListFilters`, `toColumnFilterValue`, `containsPattern` and its inverse) are untouched, and the removal helpers are siblings of `withFilters`. The row's per-keystroke debounce becomes unnecessary inside a commit-on-Apply dialog — a deletion, not a redesign.
- **Filtering costs one more click than the row did — except where it costs none.** An operator who filtered the same column constantly paid nothing before and pays an icon-click now; where that cost matters, the resource declares a hot filter and the stance is one press. The row taxed *every* grid's width and legibility all the time; the dialog-plus-hot-filter split prices each filter by how it is actually used.
- **Hot filters add a config vocabulary and a suppression rule to test** (ADR-0036): a declared group renders and round-trips through the URL; pressing the active `eq` option releases it; a chip is suppressed exactly while a button displays its filter and reappears for unrepresentable values; Clear all releases pressed buttons. The users grid's "Deleted only" is expected to become the first `presence` hot filter — the D4.6 sweep decides whether the `deletedAt` column keeps a duplicate dialog control or drops it.

## Alternatives considered

- **Keep the always-visible filter row.** The status quo, and the complaint: every column pays its widest filter's width (`dateRange` proves it), the header area carries controls whether or not anyone is filtering, and the row still offers no summary, no clear-all, and no account of foreign filters. The row also required its own accessibility patch (`td` in a `thead`) to avoid mis-rolling; the on-demand design has nothing in the header but headers.
- **Popover instead of dialog.** Anchored to the icon, arguably lighter UX for a one-field edit, and the shadcn idiom for header menus. The dialog was the explicit product decision, and it holds on its merits: it serves small screens without a second code path (a popover needs a mobile fallback; a dialog *is* one), and the content — a labelled form, sometimes two dates and two buttons — is a form, not a menu. The door stays open (§Decision): a later popover presentation of the same content would change the overlay, not the decision.
- **A single "all filters" panel editing every column at once.** One surface, but it loses the spatial tie between a filter and its column — the thing the header icon preserves from the row — and the bar plus per-column dialogs already compose to the same capability: see everything applied, change any one thing.
- **Faceted-filter buttons in the toolbar for every filterable column.** shadcn's own data-table idiom. It scales badly past about three filterable columns (the users grid has five), turns the toolbar into a second header, and duplicates the spatial anchoring the real header already provides. §Hot filters is the deliberate, bounded version of this idea: toolbar buttons for the two or three filters a resource *names* as stances, not for every filterable column by default.
- **Hot filters as ad-hoc page components instead of config.** Each page composing its own button group over `withFilters` — workable, and it is exactly the escape hatch kept for the bespoke case. Rejected as the default because the declarable case is the common one, and config is what makes a hot filter one line in the resource, tested against the contract, instead of a copy-pasted component drifting per page.
- **Live-commit inside the dialog.** Symmetry with the row's behaviour, but the row's debounce trick does not transfer: a half-typed range is a different query, not a nearly-right one, and live-committing it refetches garbage between the two halves of the operator's intent. Apply makes one navigation carry one meaning, and it is what the explicit Clear pairs with.
