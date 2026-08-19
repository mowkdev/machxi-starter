# ADR-0035: Config-driven resource UI — AppGrid on AG Grid CE, and config-driven forms on React Hook Form

- Status: proposed
- Date: 2026-08-19

> Written at the opening of D3, alongside ADR-0030–0034 and ADR-0036. [ADR-0025](0025-deliverables.md) rule 3 keeps "agreed" and "built" as separate facts: `D3.6` implements the machinery this ADR describes, and `D3.7`–`D3.9` (staff, users, profile pages) are the proof it is worth having. It stays amendable in place while D3 is `in progress` ([`docs/plan/README.md`](../plan/README.md)).

## Context

The admin panel is, at its core, a CRUD surface over resources: a table of staff, a table of users, a create form, an edit form, a profile form. [ADR-0031](0031-ui-design-system.md) supplies the primitives (shadcn components, `Field` composition, theme tokens); [ADR-0032](0032-admin-app-architecture.md) supplies the slices (entities own resource knowledge, features own behaviour, pages compose); ADR-0033 supplies `ApiError`; [ADR-0034](0034-server-state-and-notifications.md) puts list state in the URL and operation feedback in mutation meta. What none of them decides is **how a resource's table and forms are declared** — and with two resources whose screens are structurally identical, the choice is between writing each screen twice by hand or declaring each resource once.

The forces:

- **Two resources today, N tomorrow.** Hand-written grids and forms are cheapest at two. This repository is a blueprint; its value is the shape a tenth resource follows, and "copy the staff page and edit it" is the shape drift is made of.
- **The server owns list semantics.** [ADR-0014](0014-pagination-filtering-sorting.md) gives every list endpoint offset pagination, allow-listed sort, an operator-suffixed filter language and `q` search — and `listQuerySchema` in `@repo/contracts` rejects anything outside the allow-lists as a `VALIDATION_ERROR`. Rich client grids default to the opposite model: all rows on the client, sorted and filtered locally. A grid that quietly sorts one fetched page while implying it sorted the dataset is lying to the operator; the design must make the server the only sorter.
- **Validation already exists, once.** [ADR-0011](0011-middleware-pipeline.md)/[ADR-0023](0023-shared-contracts-package.md) put every request schema in `@repo/contracts` — `createStaffBody`, `updateStaffBody`, `createUserBody`, `updateProfileBody` and the rest. A form that re-declares those rules client-side will drift from them; a form that imports them cannot.
- **Grid feature depth is a product requirement**, not a nice-to-have: column resize/reorder/pin, keyboard navigation, range niceties — the things admin operators expect from a data grid and a hand-rolled table grows one bug at a time.

External facts this ADR relies on, verified 2026-08-19: **AG Grid Community is MIT-licensed, v36.x current, React 19 supported since 34.3.0; CE ships only the client-side and infinite row models — the server-side row model (and the Set Filter) are Enterprise.** shadcn's current direction is form-engine-agnostic `Field` primitives composed with a form library directly; the old RHF-coupled `<Form>` wrapper is legacy. React Hook Form is v7, with zod via `@hookform/resolvers`.

## Decision

### One `ResourceConfig` per resource, serializable, in the entity slice

**Each resource declares one config — grid columns and form fields together — in its entity slice (ADR-0032).** A resource's UI vocabulary is written once; the staff table and the staff form cannot disagree about what a staff member is.

**Configs are data; functions live in registries.** A config carries names, labels, initial values, component and formatter *keys*, and per-usage overrides — never functions. This is the load-bearing rule, and the reasons are recorded so nobody "improves" it away: a function in config kills serializability (no diffing, no snapshotting in tests, no logging a config to see what a screen will do), kills override-merging (two functions cannot be deep-merged; two data objects can), and makes the UI vocabulary unbounded. A **named registry** — a typed `as const` map from key to implementation — keeps the vocabulary finite, typed and testable: adding a formatter is adding one named, unit-tested entry, and a typo'd key is a compile error, not a blank cell.

```ts
// apps/admin/src/entities/staff/staff.config.ts  (entity slice, ADR-0032)
export const staffResourceConfig = {
  name: "staff",
  columns: {
    email:       { header: "Email", sortable: true },
    firstName:   { header: "First name", sortable: true },
    lastName:    { header: "Last name", sortable: true },
    roles:       { header: "Roles", cellRenderer: "rolesList" },        // registry key
    status:      { header: "Status", sortable: true, cellRenderer: "statusBadge" },
    lastLoginAt: { header: "Last login", sortable: true, formatter: "dateTime" },
    createdAt:   { header: "Created", sortable: true, formatter: "date" },
    actions:     { cellRenderer: "rowActions" },
  },
  fields: {
    email:     { label: "Email", component: "input", props: { type: "email" }, variants: ["create"] },
    password:  { label: "Initial password", component: "input", props: { type: "password" }, variants: ["create"] },
    firstName: { label: "First name", component: "input", initialValue: "" },
    lastName:  { label: "Last name", component: "input", initialValue: "" },
    roles:     { label: "Roles", component: "multiCheckbox", options: STAFF_ROLES, initialValue: ["editor"] },
    status:    { label: "Status", component: "select", options: STAFF_STATUSES, variants: ["edit"] },
  },
} as const satisfies ResourceConfig;
```

Configs are `as const`; everything downstream derives its types from them. `variants` states which of `create` / `edit` a field appears in — `email` is create-only because `updateStaffBody` deliberately omits it, and the config must tell the same story as the contract.

### The grid half: `AppGrid`

**`AppGrid` lives in the shared layer (ADR-0032) and wraps `AgGridReact` — AG Grid Community v36, client-side row model.** It takes the resource's column config plus optional per-usage overrides, deep-merges them (data merges; that is what the no-functions rule buys), resolves every `formatter` / `comparator` / `cellRenderer` key through the **grid registry**, and hands AG Grid real column definitions.

```ts
// apps/admin/src/shared/grid/registry.ts
export const gridRegistry = {
  formatters:    { date, dateTime },                       // (value) => string
  comparators:   { serverOrder },                          // see below
  cellRenderers: { rowActions, statusBadge, rolesList },   // named components
} as const;

// apps/admin/src/shared/grid/app-grid.tsx
export const AppGrid = <T,>(props: {
  columns: ColumnConfigMap;             // from the resource config
  overrides?: DeepPartial<ColumnConfigMap>;
  page: Page<T>;                        // ADR-0014 — one page, not a dataset
  listState: ListState;                 // ADR-0034 — the URL is the source of truth
  onListStateChange: (next: ListState) => void;
  context?: Record<string, unknown>;    // handlers for cellRenderers
}) => { /* resolves keys, renders AgGridReact */ };
```

**Theming binds to ADR-0031's tokens.** AG Grid's Theming API takes CSS variable references (`themeQuartz.withParams({ backgroundColor: "var(--background)", … })`), so the grid reads the same `@theme` variables in `@repo/ui/globals.css` as every shadcn component. Dark mode costs nothing extra: the `.dark` class swaps the variables and the grid follows.

**The server owns data operations — the honesty clause.** The API paginates (ADR-0014) and CE has no server-side row model, so AppGrid renders **exactly one page**, fed by the ADR-0034 list query. Everything AG Grid would do locally is suppressed, because a grid that sorts or filters only the 20 visible rows while its header arrows imply the dataset would be lying:

- **AG Grid's own pagination is off.** The pager is a toolbar control reading `meta.pagination` (`offset`, `limit`, `total`) and writing `offset` / `limit` URL search params (ADR-0034), which refetch.
- **Sort clicks never reorder rows locally.** Every sortable column gets the registry's `serverOrder` comparator — it reports equality, so the client-side model preserves server order — and AppGrid's `onSortChanged` serialises the sort model to the ADR-0014 comma syntax (`-createdAt,email`) into the URL. The header indicator changes, the URL changes, the refetched page arrives already ordered. Columns whose field is not in the endpoint's `sortable` allow-list are configured non-sortable; offering the click and answering it with a `VALIDATION_ERROR` toast would be worse than not offering it.
- **Per-column AG Grid filter UIs are off by default in v1.** Filtering and search are toolbar controls that write ADR-0014 query params to the URL: a `q` input (debounced) where the endpoint is `searchable`; a status `Select` emitting `filter[status]=…` / `filter[status][in]=…` — CE's Set Filter is Enterprise, so an enum filter is a shadcn control, not a grid popup; a "show deleted" toggle on the users list emitting `filter[deletedAt][null]=false`. A column may opt in to an AG Grid filter UI **only where `listQuerySchema` allow-lists that field with a matching operator**, with the mapping declared in config: a date column's filter maps `greaterThan`/`inRange` to `gt`/`gte`+`lte` on `createdAt` or `lastLoginAt`; a text filter on `email` maps "equals" to `eq` and "contains" to `like` with the operator's `%`/`_`/`\` escaped before wrapping in `%…%` — ADR-0014 does not escape `like` patterns because the client writes them on purpose, so a UI that writes them on the operator's behalf must escape what the operator typed.

The config-versus-contract agreement is testable rather than trusted: ADR-0036's unit tier runs each config's sortable and filterable declarations through the actual contract schema (`listStaffQuery.safeParse({ sort: "email" })`), so a column the API would reject fails a test before it fails an operator.

**Row actions are a named cellRenderer, handlers come from context.** `rowActions` (edit / delete / reset password) reads its handlers from AG Grid's `context`, which the feature passes into `AppGrid`. Entities supply config, features supply behaviour — the config stays serializable and the same renderer serves every resource.

### The form half: two contexts, one join point

**Two nested providers, deliberately separate:** RHF's own `FormProvider` carries form *state*; `AppFormProvider` carries the resource's field-config map and which variant is being rendered (`create` | `edit`). They answer different questions — "what is the value of `email`" versus "what *is* `email`" — and merging them would couple the config machinery to RHF's context shape for no gain.

**`AppFormInput` is the join point.** `<AppFormInput fieldName="email" />` reads the field's config from the AppForm context, form state via the RHF context, resolves the field's `component` key through the **field-component registry** (`input`, `textarea`, `select`, `checkbox`, `switch`, `multiCheckbox`, …), and renders.

```tsx
// apps/admin/src/shared/form/registry.ts — every entry is a thin adapter
export const fieldRegistry = {
  input: InputField, textarea: TextareaField, select: SelectField,
  checkbox: CheckboxField, switch: SwitchField, multiCheckbox: MultiCheckboxField,
} as const;

// pages/staff-create.tsx — layout is JSX, config is what, placement is where
<AppFormProvider fields={staffResourceConfig.fields} variant="create" form={form}>
  <form onSubmit={form.handleSubmit(onSubmit)}>
    <fieldset disabled={createStaff.isPending} aria-busy={createStaff.isPending}>
      <StaffFormInput fieldName="email" />
      <StaffFormInput fieldName="password" />
      <div className="grid grid-cols-2 gap-4">
        <StaffFormInput fieldName="firstName" />
        <StaffFormInput fieldName="lastName" />
      </div>
      <StaffFormInput fieldName="roles" />
      <Button type="submit" loading={createStaff.isPending}>Create</Button>
    </fieldset>
  </form>
</AppFormProvider>
```

- **Every registry entry is a thin adapter**: the shadcn control composed inside shadcn `Field` primitives (`Field`, `FieldLabel`, `FieldDescription`, `FieldError` — label, description, error and aria wiring in one place, per ADR-0031), driven through RHF's `Controller` **uniformly**. Controlled components (`Select`, `Checkbox`, `Switch`) need `Controller` anyway; using it for text inputs too means one wiring pattern instead of two, and `Controller` isolates re-renders to the field that changed — uniformity beats micro-optimising `register()` onto text inputs. Adapters also own the contract-shaped edge cases: the input adapter for a nullable field (user names, `updateUserBody`) maps an emptied input to `null`, because "clear it" is a legal request `""` cannot express.
- **Validation is the API's own schema.** `useForm({ resolver: zodResolver(createStaffBody), … })` — the *same* `@repo/contracts` schema the API validates with (ADR-0011/0023), so client and server cannot drift: a password rule tightened in contracts tightens the form in the same commit. Server-side field errors arrive as an `ApiError` (ADR-0033) whose `details` name field paths; the submit handler maps them back onto RHF via `setError(path, { type: "server", message })`, so a rule only the server can check (duplicate email) still lands next to the field. Unmapped errors follow ADR-0034's operation-level policy.
- **`defaultValues`** derive from the config's `initialValue`s (create) or the fetched entity (edit); edit submits are pruned to RHF's `dirtyFields`, so the contracts' "provide at least one field" refinement measures what the operator actually changed.
- **Layout stays JSX.** Config declares *what* a field is; *where* it renders is the page's JSX, placing `AppFormInput`s freely — columns, cards, separators, whatever the page needs. This line is what keeps the pattern from becoming a form DSL, and it is a rule, not a preference: the day config grows a `layout` key is the day this ADR needs superseding. The escape hatch is equally explicit: a bespoke field may bypass the registry entirely and compose `Controller` + `Field` primitives by hand inside the same provider.
- **Type safety.** Configs are `as const`; `createAppFormInput(staffResourceConfig.fields)` returns a component (one line in the entity slice, `StaffFormInput` above) whose `fieldName` prop is `keyof` that field map — a typo'd field name is a compile error, not a silently empty control.
- **The submit lifecycle is explicit.** Submitting *is* the ADR-0034 mutation's `isPending`, and it drives three things at once: RHF's `disabled` option on `useForm` (disables every registered field centrally), a `<fieldset disabled>` with `aria-busy` around the form (catches anything unregistered, including the escape hatch), and the submit button's loading state. All fields stay disabled until the request settles — success or failure. Validation errors render inline via `FieldError`; the operation-level toast is ADR-0034's business, not the form's.

### The risk, stated

Config-driven UI earns its cost with many uniform resources and **fights truly bespoke forms** — a wizard, a builder, anything whose fields depend on each other's values in ways a flat config cannot say. The mitigations are structural, not hopeful: the JSX-layout rule keeps pages free to arrange anything, and the escape hatch keeps bespoke fields first-class rather than contortions of the registry. Two resources (staff, users) plus the profile forms are the D3 proof; if the pattern already chafes at three screens, that is a finding, and superseding this ADR is cheaper than working around it.

### What this does not decide

- **Data fetching, caching and URL state mechanics** — ADR-0034 owns the list query, the mutations and their meta; this ADR only consumes them.
- **Which slice owns which file** beyond what is shown — ADR-0032.
- **Anything about `apps/web`** — the machinery lives in `apps/admin`'s shared layer for now; promotion to a shared package is a decision for the deliverable that would need it, not this one.

## Consequences

- **Two registries to maintain** — grid (formatters, comparators, cellRenderers) and field components. That is a feature, not a tax: the registries *are* the finite UI vocabulary, every entry is named and unit-testable in isolation, and a reviewer can read the whole vocabulary in two files.
- **AppGrid and AppFormInput are unit-testable against configs** (ADR-0036): feed a config, assert the resolved column defs or the rendered field — no API, no browser. The config-versus-contract tests (sortable/filterable through `listQuerySchema`, field maps against the request schemas' keys) turn "the config lies about the API" into a red test.
- **Adding a resource is config + entity hooks + thin pages.** Declare the `ResourceConfig`, wire the ADR-0034 query/mutations, compose two pages of JSX. That sequence is the checklist of a future `new-resource-ui` skill, the way `/new-api-module` encodes ADR-0009's.
- **AG Grid's bundle weight is real** — mid-size as data grids go, and CE's module registry keeps unused features out — and it is mitigated by ADR-0032's route-level code splitting: the grid loads with the list routes, not with the login page.
- The honesty clause costs features CE would happily fake: no client-side quick-filter across the dataset, no local sort of "everything". Operators get exactly what the API can answer, and the URL (ADR-0034) reproduces any view they are looking at.
- shadcn `Field` primitives being form-engine-agnostic means the RHF choice is contained in the adapters: swapping the form engine later would rewrite one registry, not every page.

## Alternatives considered

- **Hand-written grids and forms per page.** Fine at two resources, and genuinely simpler for the first one. Rejected because the blueprint exists for N: the tenth copy-pasted page is where labels, disabled states and error wiring quietly diverge, and no test notices.
- **TanStack Table.** Headless, lighter, excellent — and everything visual (virtualisation, column resize/pin/reorder, keyboard model) is bring-your-own. AG Grid is chosen for feature depth as a product requirement; paying for it in bundle weight is the recorded trade.
- **AG Grid Enterprise (server-side row model).** SSRM is exactly the server-owns-data model this ADR wants — behind a commercial license a starter repository cannot assume. CE plus the one-page discipline gets the same honesty for free.
- **JSON-schema form generators (react-jsonschema-form, uniforms).** The fullest version of config-driven — and they own the markup and styling, which is precisely what the ADR-0031 shadcn approach exists to own. Surrendering the `Field` composition to a generator's theme layer buys automation at the cost of the design system.
- **Functions directly in config** (a `format: (v) => …` per column). More convenient for exactly one week; kills serializability, diffing and deep-merged overrides, and makes the UI vocabulary unbounded. The registry indirection is the price of configs that are data.
- **shadcn's legacy `<Form>` wrapper.** Coupled to RHF's context shape and superseded upstream by the `Field` primitives ADR-0031 already ships. Building new machinery on a deprecated composition would be adopting technical debt at birth.
