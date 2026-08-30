# ADR-0041: Persisted grid preferences — column sizing, order and visibility

- Status: superseded by [ADR-0054](0054-design-language-instrument.md) (delta: where Create and the Columns control are drawn)
- Date: 2026-08-20

> Written at the opening of D4 (data grid v2), alongside ADR-0037–0040. [ADR-0025](0025-deliverables.md) rule 3 keeps "agreed" and "built" as separate facts: `D4.5` implements this store ([`docs/plan/0004-data-grid-v2.md`](../plan/0004-data-grid-v2.md)), on the frame [0037-grid-viewport-layout.md](0037-grid-viewport-layout.md) budgets and the toolbar [0038-grid-selection-and-capabilities.md](0038-grid-selection-and-capabilities.md) owns. It stays amendable in place while D4 is `in progress`. **Accepted 2026-08-20**, at the head of `D4.5` — the last of the D4 set to be accepted, on the per-step schedule the deliverable runs on. **Superseded in part 2026-08-30 by [ADR-0054](0054-design-language-instrument.md)**, at the head of `D11.12`: a **delta** per [ADR-0050](0050-adr-lifecycle-and-verification.md) §Lifecycle rule 1, and the delta is four words below — the Columns menu no longer lives "in the toolbar region 0038 reserves" but in the page-header band, icon-only. **The surface itself is untouched**: the popover rather than a menu, the checkbox-and-reorder row, drag within the list, Reset to defaults disabled while nothing deviates, the zod-validated store behind its three-function adapter, and the URL/preferences/history/table taxonomy.

## Context

Two earlier ADRs each left a deliberate blank, and this ADR is where the two blanks meet.

**[ADR-0035](0035-config-driven-resource-ui.md) deferred the ergonomics by name.** Its grid half lists what is "deliberately not built until a need names it: column resizing, reordering, pinning" — recorded as additive AppGrid work, not a migration, and flagged in its own §Consequences as "the consequence most likely to trigger this ADR's revisit clause". D4 is the need naming it: operators living in these grids want the email column wide, the timestamps hidden, and the columns they compare adjacent — and they want that arrangement to survive a reload. This ADR is the delegation being exercised, not the deferral being second-guessed; nothing in ADR-0035's design changes, which is exactly what "additive AppGrid work" promised.

**[ADR-0032](0032-admin-app-architecture.md) §Client state stays minimal named the trigger.** It enumerated three categories — server state in the query cache ([ADR-0034](0034-server-state-and-notifications.md)), session state in the [ADR-0033](0033-browser-api-client-and-session.md) store, everything else local or in the URL — and said: "a fourth category appearing is the signal to write that ADR, not to reach for a store." A grid arrangement is the fourth category. It is not server state (no refetch returns it), not session state (its disclosure moves no attacker forward), not URL-worthy (below), and not local component state (it must outlive the component and the tab). This ADR is the one that sentence mandated.

The state it covers exists nowhere today, verified 2026-08-20: `gridFeatures` (`apps/admin/src/shared/grid/features.ts`) registers exactly `rowSortingFeature`, `rowPaginationFeature` and `columnFilteringFeature`; `columnSizing`, `columnOrder` and `columnVisibility` appear nowhere in `apps/admin`; column order is the config object's declaration order (`ColumnConfigMap`'s own doc comment: "reordering columns is reordering lines"); and `ColumnConfig.hidden` is a static per-usage override, decided at build time, not by an operator. The only `localStorage` user in the app is the theme provider (`apps/admin/src/app/providers/theme.ts`), whose header comment already states the carve-out this ADR stands on: ADR-0033's storage rule (amended D3.1) forbids credentials — "no access token, no CSRF token and no principal" — and explicitly permits non-credential display state, with the theme as the precedent.

The remaining force is a boundary dispute this ADR must settle before writing any code: ADR-0034 put list state in the URL so that "every grid state is a deep link". Column widths are grid state too, and the lazy reading — "grid state goes in the URL" — would put them there. That reading is wrong, and saying why is the spine of the decision.

## Decision

### The taxonomy: the URL owns the view, preferences own the ergonomics

**Route search params own *view* state — what data is being looked at: `offset`, `limit`, `sort`, `filters`, `q`.** That is ADR-0034's decision, untouched: a view is a claim about the dataset, it is shareable by construction, and a link that reproduces it is the point.

**The preferences store owns *ergonomics* state — how this operator likes the grid arranged: column sizing, column order, column visibility.** Ergonomics are personal, not propositional: two operators looking at the same view legitimately hold different arrangements, and a shared link **must not impose the sender's column widths on the receiver** — which is precisely what URL-held sizing would do, besides bloating every link with state no one meant to send. Device-local today, account-portable tomorrow (§Persistence), and never part of what a link says.

**The table owns nothing durable.** Every stateful slice AppGrid runs is fully controlled — sorting, filters and pagination from the URL (as today), sizing, order and visibility from the preferences store (new). The engine remains what ADR-0035 made it: a renderer of state owned elsewhere.

Two exclusions follow from the taxonomy and are decisions, not omissions: **sort, filters and pagination are not persisted here** — they are view state, the URL owns them, and a second owner is the drift ADR-0034 exists to prevent; and **sizing, order and visibility never enter the URL**. A "saved views" feature — named, sharable bundles of *view* state — is a different and bigger decision, deliberately not smuggled in as a preference (§Alternatives).

### Three v9 features, fully controlled

The three preferences are the corresponding TanStack Table v9 feature modules, added to `gridFeatures` — under the amended ADR-0035's features model, a capability is an import, so these arrive as three registered features (the v9 exports for column sizing, ordering and visibility; exact export names verified at implementation, as the D3.6 amendment was) and cost the bundle only their state-and-API modules. No row model joins them: reordering and hiding columns computes nothing over rows, and the structural honesty of `features.ts` — the code that could sort a page locally is absent, not disabled — is preserved.

Their state slices (`columnSizing`, `columnOrder`, `columnVisibility`) join `state` on `useTable` as controlled values with `on*Change` handlers that write the preferences store, the same loop sorting already runs against the URL. AppGrid renders what the store holds; the store is the owner.

**Amended 2026-08-20 (D4.5): v9 splits sizing into two features, and only one of them is registered.** The exports verified at implementation are `columnSizingFeature` (the durable `columnSizing` record, `column.getSize()`), `columnOrderingFeature`, `columnVisibilityFeature` — and `columnResizingFeature`, which is the transient drag state plus `header.getResizeHandler()`. The first three are registered and controlled as above. The fourth is **refused**, and the reason is a number: `getResizeHandler` captures its start width from `column.getSize()`, which for a column nobody has sized yet is the engine's `defaultColumn.size` of 150px — while this grid's actual default is *whatever the content needed*, because it has never set a width on anything. So the first pixel of the first drag would snap a wide email column to 150px before tracking the pointer at all. The alternatives were to freeze every column's width at mount (which would end the content-based auto-layout every grid has today, for the benefit of columns nobody has touched) or to take the start width from the header cell. `AppGrid` does the second in about fifteen lines of pointer events, still writing through `table.setColumnSizing` so the path in and out is the one every other control takes. The transient slice then has no owner, which is the taxonomy's third clause — the table owns nothing durable — arriving in a stronger form than the ADR asked for: on this grid the table owns nothing at all.

### The UI: drag to size, a menu for the rest

- **Resize is a pointer drag on the header edge**, wired through the v9 column-sizing handlers on the sticky header ADR-0037 provides — the handle never scrolls away with the rows. A width that overflows the frame is what ADR-0037's one scroll container is for. Double-click on a handle to reset that column to its default is optional polish, not contract.

  **Amended 2026-08-20 (D4.5): the handle is a named button and it takes arrow keys.** The bullet above describes a pointer gesture and says nothing about the keyboard, which would have made column width the one affordance in this panel reachable by mouse alone — in an app where every other control is operable by name and by key, and which spent a step of `D4.4` on a filter dialog's focus return. It costs an `aria-label` (`"Resize <header>"`) and two keys: left and right nudge the edge by 16px, `Enter` and a double-click return the column to content width. The floor is 64px, so a mis-drag stays recoverable by dragging rather than by a Reset that would undo the operator's other columns too.

  **And a width has to be applied to a block *inside* the cell, not only to the cell.** `@repo/ui`'s `TableHead` and `TableCell` are `whitespace-nowrap`, and under `table-layout: auto` a cell's own `width` is a suggestion its content is free to overrule — so a narrowed column simply refused to narrow. A fixed-width, `overflow-hidden` block inside the cell cannot be overruled, and it is rendered **only for columns somebody has actually sized**: an unsized column keeps exactly the markup and the content-width layout it has today, which is what makes this feature additive rather than a re-layout of every grid.
- **Visibility and order live in a "Columns" menu** in the toolbar region [0038-grid-selection-and-capabilities.md](0038-grid-selection-and-capabilities.md) reserves: a checkbox per column to show and hide, reordering by up/down controls against the menu's list (drag within the menu is acceptable if the shadcn primitives give it freely), and a **"Reset to defaults"** action that clears the stored entry and returns the grid to its config.

  **Amended 2026-08-20 (D4.5): the "menu" is a `Popover`, not a `DropdownMenu`.** The word was left open here and the primitive matters: a Radix menu treats each item as one actionable unit under a roving tabindex and closes on activation, while a row in this list is *three* controls used in sequence — a checkbox and two reorder buttons. Building it as a menu means talking the primitive out of both behaviours with `onSelect` preventions and nested focus handling; a Popover is a plain container and the row is ordinary DOM. `Popover` joins the `shared/ui` door for it, which under ADR-0031 is the visible line in a diff that adding to the inventory is supposed to be. "Reset to defaults" is disabled while nothing deviates, because an enabled control with nothing to do is the affordance ADR-0038 spent a step removing from toolbars.
- **Full header drag-and-drop reordering is deliberately not built.** It needs a dnd dependency this repository has never had a reason to take, and it fights two surfaces that already own the header: the sortable-header click (ADR-0035) and ADR-0037's sticky positioning. The menu does the same job with primitives already in `@repo/ui`; §Alternatives records the trade.
- **Structural columns are exempt by construction.** The `actions` column and ADR-0038's selection column do not appear in the menu, cannot be hidden or reordered, and are not resizable: selection is pinned first and actions last by `buildColumns`, not by convention. Resizing is otherwise globally on — per-column `enableResizing` config flags are refused as YAGNI (§Alternatives).

  **Amended 2026-08-20 (D4.5), on how that is spelled — and "by `buildColumns`" above is superseded by it.** "The `actions` column" is a column *name*, and `shared/grid` may not hold one (ADR-0032). The discriminator is the **registry key**: a column whose `cellRenderer` is `rowActions` is chrome, which is `shared/grid`'s own vocabulary, so a resource that called its column `operations` gets the right answer and one that called an ordinary column `actions` does not get the wrong one. It is carried in `columnMeta` rather than as v9's `enableResizing`, because that option belongs to the `columnResizingFeature` this grid does not register (and a width is validated `finite().positive()` on read, not merely as a number: a zero or a negative would render a column that cannot be seen and cannot be grabbed back) — and the fact is needed in three places (the menu, the handle, and `enableHiding`) regardless. Positions are composed in `AppGrid` rather than stored: the effective `columnOrder` is `[selection?, ...preferences.order, ...structural]`, so there is no arrangement an operator can reach that puts the row menu in the middle of the data, and the store never sees a structural id to have to reject.
- **Amended 2026-08-20 (D4.5): the last visible column cannot be hidden.** Nothing in the vocabulary stopped an operator unchecking every box, and the result is not a preference — it is a blank rectangle where the data was, with the only control that undoes it inside the menu that produced it. The last remaining checkbox is disabled rather than left to be clicked, which is the same argument as the 64px resize floor one control along: a mistake an operator can make in one click should be recoverable in one click, or prevented.

- **Config `hidden` stays what it is.** A column a per-usage override drops was never rendered and is not offered in the menu; preference visibility governs only the columns the merged config actually declares. Config decides what a grid *has*; preferences decide what the operator currently *shows*.

### Persistence: a store behind a storage adapter

**One closure-based store per grid, in `shared/grid` (resource-agnostic, per ADR-0032), with the observable shape ADR-0033's session store established** — `get`/`set`/`subscribe`, so React reads it through `useSyncExternalStore` and nothing in the store knows React exists:

```ts
// apps/admin/src/shared/grid/preferences.ts
export interface PreferenceStorage {
  read: (key: string) => string | null;
  write: (key: string, value: string) => void;
  remove: (key: string) => void;
}

export const createGridPreferences = ({ gridId, storage, defaults }: {
  gridId: string;                 // defaults to ResourceConfig.name at the call site
  storage: PreferenceStorage;
  defaults: GridPreferenceDefaults;   // derived from the merged column config
}) => {
  /* read + validate + reconcile once; hold in memory; write-through on set */
  return {
    get: () => prefs,
    set: (next: GridPreferences) => { /* assign, persist, notify */ },
    reset: () => { /* storage.remove(key), back to defaults, notify */ },
    subscribe: (listener: () => void) => { /* add; return remover */ },
  } as const;
};
export type GridPreferencesStore = ReturnType<typeof createGridPreferences>;
```

- **The adapter is the seam, and the seam is the point.** D4 ships one adapter, `createLocalStorageAdapter()` — three one-liners over `window.localStorage`. A **server-backed user-settings adapter slots in later without touching the store or AppGrid**: same three functions, same string key, same JSON value. That future user-settings API is a real intention — it is what turns "device-local today" into "account-portable tomorrow", and it belongs on the index's Planned list — but it is *not designed here*; the adapter interface and the versioned value below are the whole contract it inherits. The adapter is best-effort in both directions: a `write` that throws (quota, private browsing) is swallowed, because preferences failing to persist must degrade to preferences not persisting, never to a broken grid.

  **Amended 2026-08-20 (D4.5): the store guards the adapter as well as the other way round.** As written, "corrupt preferences must never break a grid" was a promise kept by the shipped `localStorage` adapter and by nothing else — a future server-backed adapter that let a network failure escape would have taken the whole grid down with it, and the sentence would have quietly become "unless somebody writes a strict adapter". The store's read path and both of its writes are guarded independently, so the guarantee is the store's rather than a convention adapters are asked to honour.
- **One entry per grid, versioned in the key**: `machxi.admin.grid:<gridId>:v1`, extending the naming the theme's `machxi.admin.theme` began. `gridId` defaults to `ResourceConfig.name` (`"staff"`, `"users"`), with an explicit AppGrid prop as the escape for a second grid over the same resource — two grids sharing an id would fight over one entry.

  **Amended 2026-08-20 (D4.5): a grid with no `gridId` persists nothing, unconditionally.** Sizing, ordering and hiding all still work for the life of the component; they have nowhere to be written, and the supplied adapter is *ignored* rather than pointed at a placeholder key. The alternative — a shared fallback id — is worse than not persisting, because it reproduces the exact collision `gridId` exists to prevent, arriving through the seam that was meant to make it configurable.
- **The stored value is zod-validated on read, and a failure discards silently.** A parse failure, an unknown version, hand-edited garbage — all of it falls back to config defaults without a toast, a log or an exception: **corrupt preferences must never break a grid.** The schema is client-only and lives beside the store, not in `@repo/contracts` — nothing on the wire speaks it today; the day the user-settings API does, moving it there is that ADR's work.

```ts
const gridPreferencesV1 = z.object({
  v: z.literal(1),
  sizing: z.record(z.string(), z.number().finite().positive()),  // columnId → px
  order: z.array(z.string()),                 // columnIds, complete, in render order
  hidden: z.array(z.string()),                // columnIds currently hidden
});
```

- **Amended 2026-08-20 (D4.5): the stored value is bounded as well as shaped, and the read path agrees with the write path.** "Zod-validated on read" was, as first written, a check that the *shape* was right — and a well-formed entry can still be hostile to the operator whose browser holds it. Three bounds close that, and each answers a way an entry could take a grid away from the person using it. **Widths are clamped 64–2000 on both paths** rather than merely "finite and positive": `setColumnWidth` clamps on the way in, so anything outside that range was hand-edited, and a stored `1` is a column an operator can see and cannot grab while a stored `1e12` is one column that is the whole table. **Ids and array lengths are bounded** (`z.string().min(1).max(64)`, 200 entries), because `localStorage` holds several megabytes and the Columns menu renders one row per id — an unbounded `order` hangs the tab on the one surface that contains "Reset to defaults". **And `order` and `hidden` are de-duplicated in reconciliation**, since the allow-list filters without deduping and the menu keys its rows by id: a repeat would give two rows one React key and one `<label for>`, so a single checkbox would appear to toggle both and the reorder buttons would only ever move the first. The promise this ADR makes is therefore the stronger one: **not only that corrupt preferences never break a grid, but that a well-formed one cannot either.**

- **Stored column ids are reconciled against the current config on load.** Ids the config no longer declares are dropped from all three slices; columns the config added since the entry was written are appended in config declaration order, at their default sizing and visibility. **A config change must never strand an operator on a stale layout** — a renamed column simply reverts to default, a new column simply appears, and nobody clears storage to recover a grid.

### ADR-0033 compliance, said plainly

This store is precisely the non-credential display state ADR-0033's D3.1 amendment carves out, with the theme provider as the standing precedent — an XSS that reads `machxi.admin.grid:staff:v1` learns which columns an operator prefers wide. Nothing sensitive enters the key or the value: column names and numbers only — never row data, never a filter value, never anything typed into the grid. And the client still never *reads* `document.cookie`; this is `localStorage`, behind the adapter, behind the store.

Multi-tab is last-write-wins, accepted: two tabs disagreeing about a column width for the life of a session is an ergonomics wrinkle, not a correctness problem, and the grace-window reasoning ADR-0033 applied to refresh races applies with less at stake here. The `storage` event is noted as a cheap future cross-tab sync; it is not required and not built.

### Defaults come from config

Config supplies defaults; preferences supply deviations; "Reset to defaults" returns to config — that is the whole relationship, pinned so neither side grows into the other. Default order is what it already is (declaration order); default visibility is "everything the merged config declares"; default sizing is the engine's own until a need proves otherwise, at which point `ColumnConfig` may gain an optional `size` (a number — data, per ADR-0035's no-functions rule) as an amendment to this ADR while D4 is open.

## Consequences

- **A third state owner joins the URL and the query cache, with its boundary written down.** The taxonomy — URL: view; preferences: ergonomics; table: nothing durable — is the rule a review cites when a new piece of grid state asks where it lives, and ADR-0032's client-state section anticipated exactly this arrival: the fourth category got its ADR instead of a reached-for store.
- **The reconciliation rule makes config changes safe against every browser that ever stored an entry.** Renaming, adding or removing a column is a code change with no storage migration, ever — the load path absorbs the drift.
- **The tests are enumerable ([ADR-0036](0036-admin-testing-strategy.md))**: round-trip persist and restore per `gridId`; a corrupt or wrong-version value falling back to defaults without error; config-drift reconciliation (dropped id, added id) landing on the documented result; the structural columns absent from the menu and immovable; and "Reset to defaults" removing the entry. All of it runs against an in-memory `PreferenceStorage` — the adapter seam is also the test seam.
- **The future user-settings API inherits a ready-made contract**: the three-function adapter and the versioned, zod-validated value. Building it is a later deliverable's decision (Planned); when it lands, the store and AppGrid do not change, which is the claim this design should be held to.
- **The grid's chrome grows a menu and its headers grow handles** — surface ADR-0038's toolbar and ADR-0037's sticky header were budgeted for; neither sibling needs amending to host this one.
- One more `localStorage` key ships in the bundle's behaviour. It is the second, the theme was the first, and both stand on the same ADR-0033 carve-out — a third should cite it the same way rather than treating persistence as normalised.

## Alternatives considered

- **Persist sizing/order/visibility in the URL.** One mechanism for all grid state, and every view a complete deep link. Rejected on the taxonomy: a link would impose the sender's ergonomics on the receiver, every navigation would drag widths through history, and the URL would bloat with state that answers no question about the data. The URL says *what you are looking at*; it must not say *how I like my desk arranged*.
- **Server-side persistence from day one.** The right end state for a multi-device operator, and it needs an API — endpoints, a table, a migration, a deliverable this one is not. The adapter seam gets there without blocking D4: the `localStorage` adapter is not a compromise to unwind but a first implementation of the interface the server adapter will also satisfy.
- **Persist filters, sort and pagination too.** "Remember my whole grid" reads as generosity and collides head-on with ADR-0034's URL ownership — the same state with two owners, disagreeing after the first reload. A **saved-views** feature (named bundles of view state, shareable, possibly server-held) is the legitimate version of this want, and it is a different, bigger decision for the Planned list, not a preference.
- **TanStack Table's own persistence helpers, or `localStorage` directly in AppGrid.** Fewer moving parts today, and the component is welded to a storage engine — the user-settings adapter would then be surgery on AppGrid instead of a new implementation of three functions. The adapter seam *is* the decision; everything that bypasses it buys convenience with the exact flexibility this ADR exists to keep.
- **Header drag-and-drop reordering.** The familiar gesture, and the honest price is a dnd dependency (dnd-kit or similar) nobody has needed yet, plus interaction hazards with the sortable-header click and the sticky header that each cost design time. The Columns menu delivers the capability with primitives already owned; the day reordering frequency proves the menu too slow, this entry is where the dnd decision starts.
- **Per-column `enableResizing` config flags.** Configuration for a distinction no column needs drawn: resizing is globally on, the structural columns are exempt by construction, and a flag per column would be vocabulary without a consumer. YAGNI, with the escape that adding the flag later is additive config work.
