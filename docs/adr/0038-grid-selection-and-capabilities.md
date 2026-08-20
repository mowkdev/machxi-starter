# ADR-0038: Row selection, capabilities and the grid toolbar

- Status: accepted
- Date: 2026-08-20

> One of the D4 (data grid v2) decision set, written together with [ADR-0037](0037-grid-viewport-layout.md) and [ADR-0039](0039-grid-filter-ux.md)–[0041](0041-grid-preferences.md) before the deliverable opens (`docs/plan/0004-data-grid-v2.md`, `planned`). `D4.3` is the planned implementing step. It becomes amendable in place while D4 is `in progress` in `docs/plan/README.md` ([ADR-0025](0025-deliverables.md) rule 2). **Accepted 2026-08-20**, at the head of `D4.3` and together with [ADR-0042](0042-client-side-authorization.md) — the per-step acceptance D4 runs on, and the two are halves of one question.

## Context

D3 shipped the grid this ADR extends. `AppGrid` ([ADR-0035](0035-config-driven-resource-ui.md)) renders one server page in manual mode over TanStack Table v9, whose feature model matters here: features are *registered*, not switched off — `shared/grid/features.ts` builds `tableFeatures({ rowSortingFeature, rowPaginationFeature, columnFilteringFeature })` plus the type-only `tableMeta` / `columnMeta` slots, and a capability the grid does not have is code that is not in the bundle. `getRowId` is always set (defaulting to `String(row["id"])`), so row identity is already the resource's own id rather than a position. Row behaviour arrives as data through `table.options.meta`: a feature slice exports `useStaffRowActions(onAction)` returning `RowAction[]` (keys `edit` / `reset-password` / `revoke-sessions` / `delete`), and the `rowActions` cell renderer draws the menu.

Three things D3 left undecided are now in the way.

- **There is no toolbar.** ADR-0035 (amended D3.6) says "the toolbar carries `q` alone", and the implementation took it literally: `AppGrid` renders a bare conditional `div` with `GridSearch` when `searchable`, and the Create button lives on the *page*, in a `CardHeader`'s `CardAction`, outside the grid entirely. That was fine for one action; D4 brings several — [ADR-0039](0039-grid-filter-ux.md)'s applied-filters surface and [ADR-0041](0041-grid-preferences.md)'s columns menu both need a home, and "each sibling invents a div" is how a region grows without anyone deciding its shape.
- **The grid cannot say what a resource offers.** `ResourceConfig` is `{ name, columns, fields, errorFields? }` — it describes what a resource *is*, and nothing describes what its grid surface *does*. Whether a resource can be created, edited, deleted, or deleted in bulk is answered today by which buttons a page happens to compose, which is exactly the per-page drift ADR-0035 exists to prevent.
- **Multi-row operations do not exist.** Deleting five expired accounts is five trips through the row menu and five confirms. The API offers per-row `DELETE /admin/{staff,users}/:id` only — no bulk endpoints — and the deletion rules are deliberately per-row ([ADR-0028](0028-account-deletion.md)): the rank rule, the last-super-admin invariant and the self-delete refusal are facts about *one* row and *this* actor, answered `403`/`409` per request.

The forces, then: selection state needs an owner and a scope (ADR-0034 put *view* state in the URL — is a selection view state?); capabilities need to be config without breaking the configs-are-data rule; the toolbar needs to be a real region with a declared shape; and bulk delete needs semantics that do not invent atomicity the domain rules refuse.

## Decision

### Capabilities are per-resource, serializable config

**`ResourceConfig` gains a `grid` block of booleans — what the resource's grid surface offers, declared once, in the entity slice.**

```ts
// apps/admin/src/shared/resource/types.ts
export interface GridCapabilities {
  readonly selectable?: boolean;     // checkbox column + selection state
  readonly canCreate?: boolean;      // Create button in the toolbar
  readonly canEdit?: boolean;        // edit entry in the row menu
  readonly canDelete?: boolean;      // delete entry in the row menu
  readonly canBulkDelete?: boolean;  // bulk Delete in the toolbar; requires selectable
  readonly pageSizes?: readonly number[]; // pager options; bounded by MAX_LIMIT at render
  readonly hotFilters?: readonly HotFilterConfig[]; // toolbar filter buttons (ADR-0039 owns the shape)
}

export interface ResourceConfig {
  readonly name: string;
  readonly columns: ColumnConfigMap;
  readonly fields: FieldConfigMap;
  readonly errorFields?: Readonly<Partial<Record<ErrorCode, string>>>;
  readonly grid?: GridCapabilities;          // this ADR
}
```

Flags and plain data only — the configs-are-data rule of ADR-0035 stands unamended. (`pageSizes` joined the block after AppGrid grew the equivalent prop in D3.8's URL-default fix; the capability block is where a resource *declares* it.) A capability declares *that the surface offers something*; the handler still arrives at the usage site, as a prop or through `meta`, and a function never enters config. `canBulkDelete` without `selectable` is dead data — there is no selection for the button to act on — and the config fixture tests (ADR-0036) refuse the combination rather than letting the toolbar quietly render nothing.

**One config block, two readers.** `AppGrid` reads the capabilities for what it owns — the checkbox column, the toolbar's Create and bulk Delete. The *feature's* row-action hook reads the same block for what it owns: `useStaffRowActions` omits the `edit` entry when `canEdit` is not set and the `delete` entry when `canDelete` is not — a resource without delete shows no dead menu item. The join is the config, which the feature already imports (features consume entities, ADR-0032), not a reserved-key filter inside `shared/grid` that would make the grid recognise action names it is forbidden to have opinions about.

**Amended 2026-08-20 (D4.3).** Two corrections to the block above, both found by writing it.

_`grid` is `GridConfig`, and `GridCapabilities` is the part of it the grid reads._ `D4.2` had already opened `ResourceConfig.grid` with `editSurface` ([ADR-0040](0040-record-routes-and-edit-surfaces.md)), so the snippet's `grid?: GridCapabilities` would have dropped a shipped key. `GridConfig extends GridCapabilities` and adds `editSurface`, which is better than a merge anyway: `editSurface` is a routing decision the record routes make, `AppGrid` has no business seeing it, and the narrowing [ADR-0042](0042-client-side-authorization.md) applies returns capabilities rather than the whole block.

_The block reaches both readers already narrowed._ ADR-0042 conjoins each discretionary flag with `can(action, resource)` once per screen, above both readers, so "one config block, two readers" is true of the *narrowed* block — which is what stops the menu's Delete and the toolbar's bulk Delete disagreeing about what this operator sees. The row-action hooks therefore take the block as a second argument rather than importing the config: the page passes what `useAllowedCapabilities` returned, and the hook stays ignorant of both the resource name and the role.

**Said honestly: these are UI capabilities, not authorization.** The API's guards ([ADR-0019](0019-authorization-guards.md)) remain the enforcement, exactly as the D3.7 row-menu note already records — the client does not pre-guess the rank rule or the invariants, and a capability the principal lacks server-side fails with its normal error and its ADR-0034 message. `grid.canDelete` says "this resource's grid offers deletion", not "this operator may delete".

### Selection: the v9 feature, keyed by id, ephemeral by design

**`grid.selectable: true` makes `AppGrid` register TanStack's row-selection feature and inject a leading checkbox column.** The feature joins `gridFeatures` in `shared/grid/features.ts` the way the existing three did — registered, contributing state and API, computing nothing over rows (the exact v9 export name, `rowSelectionFeature` by the current naming, is verified at implementation the way D3.6 verified the others). The checkbox column is **built in — `AppGrid` owns it, it is not a config entry.** It exists *because of* the capability, and nothing else in a `ColumnConfigMap` is positional: making each resource declare `select: { cellRenderer: "checkbox" }` first would be repetition that lets capability and column disagree. `@repo/ui`'s `TableHead` / `TableCell` already carry the `[&:has([role=checkbox])]:pr-0` hooks shadcn ships for exactly this column. The header checkbox toggles the **current page**; row checkboxes toggle rows.

**Amended 2026-08-20 (D4.3).** Three implementation facts, each of which the paragraph above would otherwise have left to be rediscovered.

_The export name is `rowSelectionFeature`, and it is registered unconditionally._ Verified against `@tanstack/table-core@9.1.2` as this ADR asked. It joins `gridFeatures` at module scope rather than per capability, because the feature set is part of the table's identity — a set that changed with a config flag would rebuild every table whose resource declared one. The capability decides whether a *column* exists to write the state, and `enableRowSelection: selectable` is what stops a resource that declares none acquiring one anyway.

_The page-scoped getters work under manual pagination, and that is not an accident of ours._ `getIsAllPageRowsSelected` reads `getPaginatedRowModel()`, which returns the pre-paginated model when `manualPagination` is on — so "the current page" is the server page in hand, which is exactly the scope this ADR says the header may honestly claim.

_The header checkbox is two-state, not three._ Radix would give `checked="indeterminate"` for free, and the shadcn `Checkbox` primitive draws the same tick for it — so a partial selection would be visually indistinguishable from "all selected", which is a worse lie than no third state at all. Editing the generated primitive to draw a dash is ADR-0031 work this step has no need of; the toolbar's "N selected" is the disclosure, and it is the honest one anyway because part of that count may be rows the operator cannot see.

**Selection state is ephemeral component state, not URL state.** This is a deliberate exception to ADR-0034's rule, recorded so it is not "fixed": that rule covers *view* state — offset, sort, filters describe what the operator is looking at, and a link reproducing them reproduces the view. A selection is **action context** — rows staged for something about to happen. A URL carrying selected ids is neither shareable nor restorable meaningfully: the recipient's fetched page may not contain the rows, the rows may no longer exist, and "here is my half-staged delete" is not a view anyone should be able to link to. So `rowSelection` is controlled React state inside the screen, held as ADR-0034's client-state carve-out already permits ("local component state — an open dialog, an uncommitted input").

Within the screen, though, selection **survives page and filter navigation**, and `getRowId` is what makes that honest: selection is keyed by resource id, so paging away and back finds the same rows selected, and a row selected on page one stays selected while the operator is on page three. The count renders what is true — **"N selected"**, not "N of this page" — with a "Clear selection" affordance beside it, because part of that count may not be visible. Selection clears on demand and after a bulk action settles; leaving the screen discards it, which is what ephemeral means.

**Amended 2026-08-20 (D4.3).** Three things "the count renders what is true" does not quite cover, found by the step's two reviews and left as behaviour rather than fixed — each with the reason, so the next reader knows they were seen.

_A row deleted through the **row menu** stays staged._ `AppGrid` prunes `rowSelection` only through `clearSelection`, so a single-row delete leaves its id in the selection: the count then includes a row that no longer exists, and a later fan-out spends one request on it to be told `404`. Pruning would mean the grid learning which rows died — a refetched page it can diff, or a delete it is told about — which is domain knowledge `shared/grid` may not hold (ADR-0032). The per-item summary reports the `404` for what it is, and that is the cheaper honesty.

_Selection across a **filter change** is the same fact one notch worse._ An operator can stage forty rows, narrow the view until none of them is visible, and confirm a count they cannot see; the count is honest and the identities are not recoverable from the screen (the confirm falls back to the raw id for any row not in the page it holds). Surviving navigation is what makes selection useful across pages, and it buys this with it. Clearing on filter change is the obvious alternative and it is not obviously right — an operator who filters *to find the next row to select* would lose their work. Recorded here rather than decided; `D4.4` rebuilds the filter surface and is where it should be decided if it is going to be.

_`selectable` is not narrowed by [ADR-0042](0042-client-side-authorization.md), on purpose._ A `manager` on `/users` therefore gets a checkbox column, a count and "Clear selection" with no bulk action reachable from any of them. Selection is not a permission and narrowing it would be `can()` deciding what an operator may *look at*; but this is the shown-but-leads-nowhere shape ADR-0042 exists to reduce, one notch quieter, and it is named so that it is a decision rather than an oversight. The day selection has a second consumer — an export, a bulk status change — it stops being visible at all.

### The toolbar becomes a real region: `GridToolbar`

**`AppGrid` grows a named toolbar region above the table — the single home for grid-level actions.**

- **Left side:** `GridSearch`, exactly as today (`q` is the endpoint's property, not any column's — ADR-0035, amended D3.6); the hot-filter button groups a resource declares via `grid.hotFilters` ([ADR-0039](0039-grid-filter-ux.md) owns their shape, semantics and rendering — this one only reserves the seat, after the search); and the applied-filters interplay that same ADR defines — the bar itself is its. The selection count and "Clear selection" render here when a selection exists.
- **Right side, capability-driven:** **Create** when `canCreate`, its handler a grid prop (`onCreate`) — the page's `CardAction` button moves into the toolbar, so grid actions have one home instead of one-and-a-half; **bulk Delete** when `canBulkDelete` *and* the selection is non-empty, its handler `onBulkDelete(ids)`; and [ADR-0041](0041-grid-preferences.md)'s columns menu, which that ADR owns.

Toolbar handlers are **props**, not `meta` — `meta` is the channel cell renderers reach through `table.options.meta`, and the toolbar is not a cell:

```ts
export interface AppGridProps<TRow> {
  // …existing props (columns, page, listState, meta, …)
  readonly capabilities?: GridCapabilities | undefined;   // the config's grid block
  readonly onCreate?: (() => void) | undefined;
  readonly onBulkDelete?: ((ids: readonly string[]) => void) | undefined;
  readonly toolbarStart?: ReactNode;                      // appended after the defaults, left
  readonly toolbarEnd?: ReactNode;                        // appended after the defaults, right
  readonly renderToolbar?: ((ctx: GridToolbarContext) => ReactNode) | undefined;
}

export interface GridToolbarContext {
  readonly selectedIds: readonly string[];
  readonly clearSelection: () => void;
}
```

**Extension slots are JSX, not config** — the same line ADR-0035 drew for form layout. `toolbarStart` / `toolbarEnd` compose extra controls around the defaults; `renderToolbar` replaces the region outright for the screen whose toolbar is genuinely bespoke. Precedence is pinned: **`renderToolbar` wins and the slots are then ignored**; otherwise the defaults render with the slots composed around them. A toolbar configured as *data* — action descriptors in the resource config — would put functions in config or invent a registry of toolbar actions nobody has asked for; capabilities say *whether*, JSX says *what else*.

**Amended 2026-08-20 (D4.3).** Two of the four handler signatures above are wrong, and both were wrong for the same reason: this ADR was written the same day as its siblings and reasoned about the toolbar in isolation from what they decided.

_`onCreate` becomes `createAction: ReactNode`._ The sentence "Create … its handler a grid prop (`onCreate`)" predates nothing — [ADR-0040](0040-record-routes-and-edit-surfaces.md) was written the same morning — but it does not survive contact with it. Composing a record is addressable state, so `D4.2` made Create a `<Link to="/staff/new" search={true}>` and made its **role** the assertion: `staff-page.test.tsx` queries `getByRole("link", …)`, and its comment says a `button` there "would mean the surface went back to being page state that a reload and the Back button cannot see". A `() => void` handler can only render a `<button>`. So the *capability* still decides whether Create renders and the *page* supplies what renders — which is the division this ADR already draws with `toolbarStart` / `toolbarEnd`, applied one prop further. The alternative, `onCreate` plus a `navigate()` inside it, keeps the ADR's letter and loses middle-click, copy-link and the role a test can name; that is a worse trade than an edit here.

_`onBulkDelete` gains the toolbar context as a second parameter._ §Bulk delete below says "selection clears when the fan-out settles", and §Selection puts the selection state inside `AppGrid` — where, with `(ids) => void`, the caller has no way to reach it. The fix is the smallest one available: hand `onBulkDelete` the same `GridToolbarContext` `renderToolbar` already gets. No new type, the state stays out of every page, and the thing that consumes a selection is the thing that ends it.

```ts
readonly createAction?: ReactNode;                        // rendered when canCreate
readonly onBulkDelete?:
  | ((ids: readonly string[], context: GridToolbarContext) => void)
  | undefined;
```

_And the region renders nothing when it holds nothing._ A grid whose endpoint is not searchable and whose resource declares no capabilities would otherwise draw an empty flex row and a gap above the table, on every such screen — the same argument the filter row already makes for itself, so it is settled the same way.

### Bulk delete: a client-side fan-out, owned by the feature slice

**Bulk delete is `Promise.allSettled` over the existing per-row DELETE endpoints, implemented in the feature slice that owns the resource's mutations. This ADR changes nothing in `apps/api`.**

```ts
// features/staff-manage/use-bulk-delete-staff.ts — one mutation, N requests
export const useBulkDeleteStaff = () =>
  useMutation({
    mutationFn: async (ids: readonly string[]) => {
      const results = await Promise.allSettled(ids.map((id) => deleteStaff(id)));
      return summarise(ids, results);   // { deleted: string[], refused: { id, error }[] }
    },
    // one invalidation and one toast after the whole fan-out settles
  });
```

The shape, pinned:

- **Confirmation first**, through the existing `ConfirmDialog`, its copy stating the count and the resource's softness or hardness — "Delete 7 staff accounts? The accounts and their role grants are deleted outright. This cannot be undone." for staff, the soft-delete sentence for users ([ADR-0028](0028-account-deletion.md): users soft, staff hard — two populations, two sentences, as the row-level dialogs already do).
- **The fan-out calls the plain API functions** (`deleteStaff(id)`, ADR-0034's hook/function split earning its keep), not N mutation hooks — so there is **exactly one list invalidation** after everything settles, not N refetch storms, and exactly one outcome to report.
- **One summary toast** — "7 deleted, 2 refused" — with each refusal surfaced per item, its message drawn from ADR-0034's `ErrorCode` message map so wording still lives in one file. The aggregate cannot ride the static `meta.success` string, so the fan-out mutation composes its own summary in its success path: a narrow, named exception to ADR-0034's "no per-callsite `toast()`", carried by this ADR because a mixed outcome has no static wording — the *policy* (codes → messages, one map) is untouched.
- **Per-item refusal is the correct semantic, not a compromise.** ADR-0028's rules are per-row: one of nine selected staff being the actor, or the last active super admin, refuses *that* delete with *its* code while the other eight are legitimate. A transactional bulk delete would have to invent all-or-nothing semantics the domain rules do not want — eight lawful deletions rolled back because a ninth was refused is a worse answer than eight done and one explained.
- **Selection clears when the fan-out settles**; the refused rows are still on screen (or reachable) and the toast names why they remain.
- **The cost, stated:** N requests against the global limiter (`300 / 15 min / IP`, [ADR-0020](0020-security-baseline.md)) — fine at admin scale, where a selection is tens of rows, not thousands — and no atomicity, which the point above reframes as the domain's own preference. A server-side bulk endpoint is the recorded alternative and belongs to a future API deliverable if scale ever demands it; it goes to the Planned list, not into D4.

**Amended 2026-08-20 (D4.3), after the step's security review.** The bullet above is the one paragraph in this ADR that was wrong rather than incomplete, and it is worth being exact about how: "fine at admin scale, where a selection is tens of rows, not thousands" is an *assumption*, and nothing in the design enforced it.

`GridPager` offers 100 rows a page and §Selection deliberately makes a selection survive paging **and filtering** — so three "select all on this page" clicks stage 300 targets, which is the entire `300 / 15 min / IP` budget in one confirm. Three things then compound it. The limiter does not set `skipFailedRequests`, so a rejected request still increments the counter that rejected it, and a fan-out that kept going after the first `429` would spend the remainder on requests guaranteed to fail. The limiter is mounted above `/auth`, so what it sheds is `login` and `refresh` — for **every operator behind the same egress IP**, for the rest of the window. And a `401` mid-fan-out meets ADR-0033's single-flight refresh, which correctly collapses N failures into one refresh and then replays all N: up to 2N+1 requests for one click.

So the fan-out is bounded, in `shared/api/bulk-outcome.ts`:

- **Five requests in flight at a time.** This does not reduce what a legitimate deletion of 300 rows costs — that is real work and should cost real requests — it paces the burst instead of making it instantaneous.
- **It stops dead the first time a refusal carries `RATE_LIMITED`.** The batch that met the limit keeps its own refusals, because those requests were made and answered; everything after it is reported as `unattempted`.
- **`unattempted` is a third outcome, not a kind of refusal.** A refusal is the server's answer about *that row*; these were never asked, and the two have opposite remedies — "you may not" against "try again in a few minutes". Folding them together would send an operator hunting for a permission problem that does not exist.

What this does **not** fix is the shape of the limiter: a per-IP budget shared with authentication is the wrong granularity for an authenticated bulk operation, and `users.routes.ts` already records a per-principal budget for expensive routes as the missing category. That is an API decision and D4 does not take it. The client's job was to stop making the problem worse, and that is what the bound does.

### What this does not decide

- **The viewport and where the toolbar physically sits** — [ADR-0037](0037-grid-viewport-layout.md), whose shell must budget the region this ADR creates.
- **The filter bar's UX** — [ADR-0039](0039-grid-filter-ux.md); this ADR only reserves its toolbar seat.
- **The columns menu and any persisted preference** — [ADR-0041](0041-grid-preferences.md).
- **Record routes and edit surfaces** — [ADR-0040](0040-record-routes-and-edit-surfaces.md); `canEdit` gates the affordance, that ADR decides where it leads.
- **Any change to `apps/api`** — the fan-out exists precisely so D4 stays a frontend deliverable.

## Consequences

- **The toolbar is the third region ADR-0037's shell must budget** — header rows and pager were the first two; the viewport ADR now lays out toolbar, table and pager together rather than discovering a div.
- **Adding a resource gains one line**: declare `grid` capabilities alongside columns and fields. The future `new-resource-ui` checklist (ADR-0035 §Consequences) grows accordingly, and a resource that declares nothing gets a plain read-only grid — the safe default.
- **"Select all" is page-scoped by design.** Manual pagination means the header checkbox can only honestly select what the client holds; an operator selecting 300 rows pages through, selecting as they go — slower, and true. The eventual answer is select-all-matching-filter, which needs server support to be honest and sits with the bulk endpoint in Planned.
- **Capabilities will be mistaken for permissions** eventually, despite the paragraph saying otherwise; the mitigation is that the mistake is harmless in the safe direction — a hidden button denies nothing the API would have allowed only to this operator, and an offered action the API refuses already renders its refusal.
- **The ADR-0034 toast convention gains its first exception**, scoped to aggregate outcomes; if a second aggregate operation appears, the `meta` typing should learn a summary shape and the exception should be folded back into the convention.
- **Tests (ADR-0036), the non-negotiable three**: selection keyed by id survives a page flip (MSW serving two pages); capability flags render and hide exactly the affordances they name — toolbar buttons and row-menu entries both; the fan-out summarises a mixed outcome (some `204`s, one `409 STAFF_LAST_SUPER_ADMIN`) with one invalidation and one toast.

## Alternatives considered

- **Selection in URL search params.** Symmetric with ADR-0034's list state and wrong about what selection is: action context, not view description. A link carrying staged ids reproduces nothing useful — the rows may not be on the fetched page, may be deleted, and were staged by someone else's intent. Ephemeral state keyed by stable ids gives the useful half (survives navigation within the screen) without the false promise.
- **A bulk-delete API endpoint now.** An API change inside a frontend deliverable, and the per-item refusal semantics argue for the fan-out anyway — ADR-0028's rules are per-row, so even a server bulk endpoint would answer per item, buying only fewer round trips. Recorded for Planned; the day a selection is thousands of rows is the day it gets built.
- **The checkbox column declared in each resource's column config.** Positional (it must be first), repeated per resource, and it lets capability and column disagree — `selectable: true` with no checkbox column, or the reverse. A column that exists *because* of a capability belongs to the machinery that reads the capability.
- **The toolbar configured as data.** Action descriptors in config either carry functions (rejected by ADR-0035's standing rule) or spawn a toolbar-action registry whose entries would each be used once. Capabilities as booleans plus JSX slots is the same division ADR-0035 drew for forms: config says what, JSX says where and what else.
- **Global "select all matching this filter".** The honest version selects rows the client has never seen, which needs the server to resolve "everything matching" at execution time — a bulk endpoint taking a filter, not an id list. Without that, the checkbox would claim a scope it cannot deliver. Rejected for now, noted with the bulk endpoint above.
