---
name: new-resource-ui
description: Checklist for adding a resource screen to apps/admin — entity slice (config, keys, api, queries), feature slice (dialogs), a thin page, the route, MSW handlers and tests, per ADR-0032/0034/0035/0036. Use for "add the <x> screen", "put <x> in the admin panel".
---

# New resource UI — `$ARGUMENTS` (resource name, singular, camelCase)

Read `/frontend-conventions` first. Mirror `entities/user` + `features/users-manage` + `pages/users` for exact style; for a **singleton** (no list endpoint, no `:id`) mirror `entities/profile` instead — it declares a `FieldConfigMap`, not a `ResourceConfig`, because a resource with no grid declaring `columns: {}` would be claiming an empty table exists.

The contract comes first: everything below is derived from `@repo/contracts`. If the endpoints do not exist yet, that is `/new-api-module`, not this.

## 1. Entity slice — `src/entities/<x>/`

- `<x>.keys.ts` — `all` / `lists()` / `list(params)` / `details()` / `detail(id)`. Never an inline key array at a call site.
- `<x>.api.ts` — `create<X>Api(client)` returning plain typed functions, `as const`. `list` reassembles the envelope into `Page<T>` (`meta.pagination`, `meta.sort`, `meta.filters` — the grid renders its own state from what the server said). Not hooks: a route loader and a test both need these without a React tree.
- `<x>.config.ts` — the `ResourceConfig`, `as const satisfies ResourceConfig`:
  - `columns` in render order (declaration order **is** column order). `sortable` only where the endpoint's `sortable` allow-list has the field; `filter` only where `filterable` has the field **and** that operator; `formatter`/`cellRenderer` are registry keys.
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
- Anything else the interaction invalidates goes here, not in the entity — this is the layer allowed to see two entity slices.
- `index.ts` — the public API.

## 3. Page and route

- `src/pages/<x>/index.tsx` — `useSearch({ from })` → `toListQuery` → the list hook → `AppGrid` (`columns`, `page`, `error`, `onRetry`, `listState`, `onListStateChange`, `meta`, `searchable`, `isFetching`, `emptyMessage`), one `useState` for the action, and the dialogs. If the page needs to know a difference between resources, that difference belongs in the config.
- `src/app/routes/_dashboard.<x>.tsx` — `validateSearch: listQuerySearchSchema`, `search: { middlewares: [stripSearchParams(listSearchDefaults)] }`, `staticData: { title }`. Under `_dashboard/` so the guard is inherited.
- Add the nav entry in `widgets/app-sidebar` if it belongs there.

## 4. Mocks and tests (ADR-0036)

- `src/test/msw/handlers/<x>.handlers.ts` — `create<X>MockState()` + `create<X>Handlers(state)`, no module state. Parse every request with the contract schema; answer through `ok` / `listOk` / `fail`. Model each refusal the UI can meet, and name the service function it mirrors — a mock more permissive than the service certifies the opposite of production.
- `entities/<x>/__tests__/<x>.config.test.ts` — every `sortable` and every filter field-and-operator pair through the real list query schema, the negative controls too, and both form variants through the create/update bodies. Derive required keys from the schema's `shape` rather than naming them by hand.
- `features/<x>-manage/__tests__/` — each write: the request the endpoint would have accepted, the refusal landing where the operator will look, the submit lock, the toast.
- `pages/<x>/__tests__/` — through `renderApp` on the real route tree: columns and rows, a header click writing the URL, the pager, the filter row, and the error panel with its retry.

## 5. Finish

- `pnpm lint && pnpm check-types && pnpm test:unit --filter admin`, then the full gate.
- Update the current plan's step notes in `docs/plan/`; if anything here forced a change under `src/shared/`, say so and say why — that is the machinery being wrong rather than this resource being special, and it is what an ADR amendment is for.
