# ADR-0041: Persisted grid preferences — column sizing, order and visibility

- Status: proposed
- Date: 2026-08-20

> Written at the opening of D4 (data grid v2), alongside ADR-0037–0040. [ADR-0025](0025-deliverables.md) rule 3 keeps "agreed" and "built" as separate facts: `D4.5` implements this store ([`docs/plan/0004-data-grid-v2.md`](../plan/0004-data-grid-v2.md)), on the frame [0037-grid-viewport-layout.md](0037-grid-viewport-layout.md) budgets and the toolbar [0038-grid-selection-and-capabilities.md](0038-grid-selection-and-capabilities.md) owns. It stays amendable in place while D4 is `in progress`.

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

### The UI: drag to size, a menu for the rest

- **Resize is a pointer drag on the header edge**, wired through the v9 column-sizing handlers on the sticky header ADR-0037 provides — the handle never scrolls away with the rows. A width that overflows the frame is what ADR-0037's one scroll container is for. Double-click on a handle to reset that column to its default is optional polish, not contract.
- **Visibility and order live in a "Columns" menu** in the toolbar region [0038-grid-selection-and-capabilities.md](0038-grid-selection-and-capabilities.md) reserves: a checkbox per column to show and hide, reordering by up/down controls against the menu's list (drag within the menu is acceptable if the shadcn primitives give it freely), and a **"Reset to defaults"** action that clears the stored entry and returns the grid to its config.
- **Full header drag-and-drop reordering is deliberately not built.** It needs a dnd dependency this repository has never had a reason to take, and it fights two surfaces that already own the header: the sortable-header click (ADR-0035) and ADR-0037's sticky positioning. The menu does the same job with primitives already in `@repo/ui`; §Alternatives records the trade.
- **Structural columns are exempt by construction.** The `actions` column and ADR-0038's selection column do not appear in the menu, cannot be hidden or reordered, and are not resizable: selection is pinned first and actions last by `buildColumns`, not by convention. Resizing is otherwise globally on — per-column `enableResizing` config flags are refused as YAGNI (§Alternatives).
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
- **One entry per grid, versioned in the key**: `machxi.admin.grid:<gridId>:v1`, extending the naming the theme's `machxi.admin.theme` began. `gridId` defaults to `ResourceConfig.name` (`"staff"`, `"users"`), with an explicit AppGrid prop as the escape for a second grid over the same resource — two grids sharing an id would fight over one entry.
- **The stored value is zod-validated on read, and a failure discards silently.** A parse failure, an unknown version, hand-edited garbage — all of it falls back to config defaults without a toast, a log or an exception: **corrupt preferences must never break a grid.** The schema is client-only and lives beside the store, not in `@repo/contracts` — nothing on the wire speaks it today; the day the user-settings API does, moving it there is that ADR's work.

```ts
const gridPreferencesV1 = z.object({
  v: z.literal(1),
  sizing: z.record(z.string(), z.number()),   // columnId → px
  order: z.array(z.string()),                 // columnIds, complete, in render order
  hidden: z.array(z.string()),                // columnIds currently hidden
});
```

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
