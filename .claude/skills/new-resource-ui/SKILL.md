---
name: new-resource-ui
description: Checklist for adding a resource screen to apps/admin — entity slice (config, keys, api, queries), feature slice (dialogs and bulk actions), a thin page, the record routes, MSW handlers and tests, per ADR-0049 (superseding 0032)/0035/0036/0043, the v2 grid of 0037-0044 and the shell and record surfaces of 0047-0048. Use for "add the <x> screen", "put <x> in the admin panel".
---

# New resource UI — `$ARGUMENTS` (resource name, singular, camelCase)

Read `/frontend-conventions` first. **The architecture record is ADR-0049**, superseding ADR-0032 since `D8.1` (2026-08-26) and itself superseded by **ADR-0051** since `D9.1` (2026-08-27) for what the `shared/` slices are — doors over packages, every layer rule unchanged; 0047 supersedes 0031 and 0050 supersedes 0024 in the same motion. 0047–0050 are frozen since D8 shipped and 0051 since D9 shipped 2026-08-28; **the D10 window is open** (since 2026-08-29), covering ADR-0052 only — **accepted 2026-08-29 at `D10.1`'s head**, where 0039 and 0048 moved to `superseded by` (deltas: each keeps every decision it made and loses only the one 0052 names). Since D9 the slices you import from — `@/shared/{api,form,grid,resource,i18n,ui,auth,theme,lib}` — are **doors over packages**: the import paths are exactly what they were, and a change behind one is a change to every consuming app at once. Mirror `entities/user` + `features/users-manage` + `pages/users` for exact style; for a **singleton** (no list endpoint, no `:id`) mirror `entities/profile` instead — it declares a `FieldConfigMap`, not a `ResourceConfig`, because a resource with no grid declaring `columns: {}` would be claiming an empty table exists.

The contract comes first: everything below is derived from `@repo/contracts`. If the endpoints do not exist yet, that is `/new-api-module`, not this.

## 1. Entity slice — `src/entities/<x>/`

- `<x>.keys.ts` — `all` / `lists()` / `list(params)` / `details()` / `detail(id)`. Never an inline key array at a call site.
- `<x>.api.ts` — `create<X>Api(client)` returning plain typed functions, `as const`. `list` reassembles the envelope into `Page<T>` (`meta.pagination`, `meta.sort`, `meta.filters` — the grid renders its own state from what the server said). Not hooks: a route loader and a test both need these without a React tree.
- `<x>.config.ts` — the `ResourceConfig`, `as const satisfies ResourceConfig`:
  - `grid` — how the grid _behaves_, and the whole of what v2 costs a resource beyond columns and fields:
    - `editSurface: "dialog" | "drawer" | "page"` (absent means `dialog`). The URL is identical across all three, so this line breaks no link and no test.
    - the capability flags `selectable` / `canCreate` / `canEdit` / `canDelete` / `canBulkDelete`. **These are not permissions** — they say what the surface offers, and `useAllowedCapabilities` conjoins them with the operator's role on the page. `canBulkDelete` without `selectable` is dead data and the config test refuses it.
    - `hotFilters` — the stances an operator presses many times a session, `enum` or `presence` only, declared **only** where `listQuerySchema` allow-lists the field and the operator. A filter that is a composition rather than a stance belongs in its column's header dialog instead, and a filter should not be both.
    - `pageSizes` if this endpoint wants other than the pager's defaults.
  - `columns` in render order (declaration order **is** column order). `sortable` only where the endpoint's `sortable` allow-list has the field; `filter` only where `filterable` has the field **and** that operator; `formatter`/`cellRenderer` are registry keys. A `filter` renders a header icon and a dialog — declare one for the compositions, and let `grid.hotFilters` carry the stances.
  - a column whose `cellRenderer` is `rowActions` is **structural**: pinned last, never hidden, reordered, resized or offered in the Columns menu. So is the selection checkbox, which `AppGrid` injects and no config declares.
  - `fields` with `component`, `label`, `initialValue`, `variants` (`create` | `edit`), `nullable` where the update body allows `null`, `description` where the operator needs the consequence stated.
  - `errorFields` — domain codes the API reports with no path, mapped to the box an operator would change.
  - `export const <X>FormInput = createAppFormInput(<x>ResourceConfig.fields);`
- `<x>.queries.ts` — `use<X>List` (with `placeholderData: keepPreviousData`), `use<X>`, and one mutation per write. `meta: { success }` on every write; `meta: { errorToast: false }` on the ones a form hosts; `...CREDENTIAL_MUTATION` on any whose variables carry a plaintext password. Invalidate `lists()` and the touched `detail(id)` — and nothing, deliberately, when the write is to a different aggregate.
- `index.ts` — the public API. Everything above is reached through it.

## 2. Feature slice — `src/features/<x>-manage/`

- `types.ts` — the action union (`{ kind: "create" } | { kind: "edit", <x> } | …`) and its handler type.
- One component per interaction. Forms use `AppFormDialog` + `zodResolver(<body schema>)`; confirms use `ConfirmDialog` with copy written for _this_ action ("this cannot be undone" is a lie about a soft delete).
- `<x>-dialogs.tsx` — one switch over the union, mounting only the active dialog, so a form cannot keep the last row's values.
- `use-<x>-row-actions.ts` — the row menu as data for `table.options.meta`. Do **not** disable an entry on a rule the API owns (rank, invariants, self-targeting): offer it and render the server's refusal.
- `use-bulk-delete-<x>.ts` where the grid declares `canBulkDelete` — a `Promise.allSettled` fan-out over the same per-row delete, bounded in flight, stopping on `RATE_LIMITED`, reporting per-item refusals through `shared/api/bulk-outcome`. One confirmation with copy written for _this_ resource, one invalidation, one summary. The selection is cleared through the `GridToolbarContext` the handler is given, because the state lives inside `AppGrid`.
- Anything else the interaction invalidates goes here, not in the entity — this is the layer allowed to see two entity slices.
- `index.ts` — the public API.

## 3. Page and route

- `src/pages/<x>/index.tsx` — `useCarriedListState(useSearch({ from }))` → `toListQuery` → the list hook → `AppGrid`, one `useState` for the action, and the dialogs. Beyond D3's props, v2 adds four and each is one line: `capabilities={useAllowedCapabilities(config.grid, "<resource>")}` — the second argument is ADR-0042's `ResourceName`, keyed by the **router path** and not by `config.name`: the users screen passes `"users"` while its config is named `"user"`, `createAction={<Button asChild><Link to="/<x>/new" state={openState}>…</Link></Button>}` (a link, not a handler — composing a record is addressable; `state`, not `search`, since ADR-0044), `hotFilters={config.grid.hotFilters}`, and `gridId={config.name}`. Plus `onBulkDelete` where the capability is declared. **The two shipped pages differ only in names and copy** — if this one needs to know something the other does not, that difference belongs in the config, and if it cannot go there it is a finding for the ADR rather than a special case here.
- **Four route files**, not one:
  - `_dashboard.<x>.tsx` — `validateSearch: listQuerySearchSchema`, `search: { middlewares: [stripSearchParams(listSearchDefaults)] }`, `staticData: { title, fullHeight: true }`. Under `_dashboard/` so the guard is inherited. **No `retainSearchParams`** (ADR-0044): a record URL carries only the record, and the list state travels as history state instead.
  - `_dashboard.<x>.index.tsx` — the **index leaf the grid does not live on**. The grid lives on the parent; putting it here unmounts it whenever a record surface opens, which is exactly what an overlay must not do. The corollary: "a record is open" is not a count of child matches, because the index is a child too.
  - `_dashboard.<x>.new.tsx` and `_dashboard.<x>.$<x>Id.tsx` — the record surfaces, the detail one loading through `ensureQueryData` on the entity's own `detail(id)` key. A loader has no hooks, so it reaches the API client through the router context. Its `errorComponent`'s way back uses `closeSearch`, so even a record that failed to load returns to the view it was opened from.
  - Every entry point spreads `openState` and every close passes `closeSearch`, both from `useRecordNavigation` — four call sites per resource, and forgetting one is an operator losing their page rather than a type error.
- Add the nav entry in `widgets/app-sidebar` if it belongs there, with its `resource` so ADR-0042 can narrow it.

## 4. Mocks and tests (ADR-0036)

- `src/test/msw/handlers/<x>.handlers.ts` — `create<X>MockState()` + `create<X>Handlers(state)`, no module state. Parse every request with the contract schema; answer through `ok` / `listOk` / `fail`. Model each refusal the UI can meet, and name the service function it mirrors — a mock more permissive than the service certifies the opposite of production.
- `entities/<x>/__tests__/<x>.config.test.ts` — every `sortable` and every filter field-and-operator pair through the real list query schema, the negative controls too, and both form variants through the create/update bodies. Derive required keys from the schema's `shape` rather than naming them by hand. **Every hot filter and every one of its options goes through the same schema**: ADR-0039's own example declared a staff `roles` group the contract has no entry for, and this is the test that caught it.
- The `grid` block's key set is asserted exactly, so a capability added without a decision about who may use it is a red test rather than a silent affordance.
- `features/<x>-manage/__tests__/` — each write: the request the endpoint would have accepted, the refusal landing where the operator will look, the submit lock, the toast.
- `pages/<x>/__tests__/` — through `renderApp` on the real route tree: columns and rows, a header click writing the URL **in the API's own spelling** (`?sort=-email&filter[status]=active`, asserted as one whole string — a per-parameter check passes just as well on a JSON blob), the pager, a filter composed in its dialog and applied, a hot filter pressed, and the error panel with its retry. Assert a record opened from a filtered page has a **bare URL** and that the grid behind it still shows that page — on what the grid renders, not on `location.state`, or the assertion survives the grid ignoring the carrier. Clear `window.localStorage` in `beforeEach` — the grid persists its columns for real here — and close any overlay before unmounting.

## 5. Finish

- `pnpm check` while iterating (lint + check-types + test:unit, one cached parallel run — deliberately unfiltered, so a contracts change breaking another package surfaces here), then the full gate `pnpm lint && pnpm check-types && pnpm test` once at the end — its lint and check-types are cache hits at that point, so its cost is the integration tier (ADR-0026).
- Update the current plan's step notes in `docs/plan/`; if anything here forced a change under `src/shared/`, say so and say why — that is the machinery being wrong rather than this resource being special, and it is what an ADR amendment is for. That claim is load-bearing and has been measured twice: `D3.8` added the second resource and `D4.6` put both on the full v2 surface, and neither needed the machinery to change.
- **Walk it in a browser.** jsdom has no layout, so nothing above can see a column that will not narrow, a pager eaten by an `overflow-hidden`, or a toolbar that wraps badly at 900px. Every layout defect D4 found was found that way.
