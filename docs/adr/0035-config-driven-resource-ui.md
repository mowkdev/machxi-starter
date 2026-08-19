# ADR-0035: Config-driven resource UI — AppGrid on TanStack Table, and config-driven forms on React Hook Form

- Status: accepted
- Date: 2026-08-19

> Written at the opening of D3, alongside ADR-0030–0034 and ADR-0036. [ADR-0025](0025-deliverables.md) rule 3 keeps "agreed" and "built" as separate facts: `D3.6` implements the machinery this ADR describes, and `D3.7`–`D3.9` (staff, users, profile pages) are the proof it is worth having. It stays amendable in place while D3 is `in progress` ([`docs/plan/README.md`](../plan/README.md)).
>
> The first draft of this ADR put the grid half on AG Grid Community; the decision was reversed before acceptance, and §Alternatives carries the full account. The forms half is unchanged.

## Context

The admin panel is, at its core, a CRUD surface over resources: a table of staff, a table of users, a create form, an edit form, a profile form. [ADR-0031](0031-ui-design-system.md) supplies the primitives (shadcn components, `Field` composition, theme tokens); [ADR-0032](0032-admin-app-architecture.md) supplies the slices (entities own resource knowledge, features own behaviour, pages compose); ADR-0033 supplies `ApiClientError`; [ADR-0034](0034-server-state-and-notifications.md) puts list state in the URL and operation feedback in mutation meta. What none of them decides is **how a resource's table and forms are declared** — and with two resources whose screens are structurally identical, the choice is between writing each screen twice by hand or declaring each resource once.

The forces:

- **Two resources today, N tomorrow.** Hand-written grids and forms are cheapest at two. This repository is a blueprint; its value is the shape a tenth resource follows, and "copy the staff page and edit it" is the shape drift is made of.
- **The server owns list semantics.** [ADR-0014](0014-pagination-filtering-sorting.md) gives every list endpoint offset pagination, allow-listed sort, an operator-suffixed filter language and `q` search — and `listQuerySchema` in `@repo/contracts` rejects anything outside the allow-lists as a `VALIDATION_ERROR`. Rich client grids default to the opposite model: all rows on the client, sorted and filtered locally. A grid that quietly sorts one fetched page while implying it sorted the dataset is lying to the operator; the design must make the server the only sorter. And the same contract bounds what a grid here can ever hold: a page is `DEFAULT_LIMIT` (20) to `MAX_LIMIT` (100) rows, so the features that justify a heavyweight client grid — virtualisation over the full dataset, local operations on everything — are precluded by the architecture before any library is chosen.
- **The grid must be *of* the design system, not next to it.** A component-library grid brings its own DOM, its own theming layer and its own interaction idiom; ADR-0031 exists so that every control on screen answers to one set of tokens and one composition model. The table is the largest surface in the app, which makes it the worst place to host a foreign body.
- **Validation already exists, once.** [ADR-0011](0011-middleware-pipeline.md)/[ADR-0023](0023-shared-contracts-package.md) put every request schema in `@repo/contracts` — `createStaffBody`, `updateStaffBody`, `createUserBody`, `updateProfileBody` and the rest. A form that re-declares those rules client-side will drift from them; a form that imports them cannot.

External facts this ADR relies on, verified 2026-08-19: **TanStack Table v8 is headless and MIT-licensed, and server-side operation is its documented, first-class mode** — `manualPagination` / `manualSorting` / `manualFiltering` with `rowCount` and fully controlled state, the engine computing nothing locally. **shadcn's Data Table is a pattern, not a component**: TanStack Table composed with the owned `Table` primitives, which is the same copy-in ownership model ADR-0031 adopts for everything else. shadcn's current form direction is form-engine-agnostic `Field` primitives composed with a form library directly; the old RHF-coupled `<Form>` wrapper is legacy. React Hook Form is v7, with zod via `@hookform/resolvers`.

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

### The grid half: `AppGrid` on TanStack Table, rendered with shadcn `Table`

**`AppGrid` lives in the shared layer (ADR-0032) and is the shadcn Data Table pattern made config-driven: TanStack Table v8 as the headless engine, `@repo/ui`'s `Table` primitives as the markup.** It takes the resource's column config plus optional per-usage overrides, deep-merges them (data merges; that is what the no-functions rule buys), resolves every `formatter` / `cellRenderer` key through the **grid registry**, and builds real `ColumnDef`s for `useReactTable`.

```ts
// apps/admin/src/shared/grid/registry.ts
export const gridRegistry = {
  formatters:    { date, dateTime },                       // (value) => string
  cellRenderers: { rowActions, statusBadge, rolesList },   // named components
} as const;

// apps/admin/src/shared/grid/app-grid.tsx
export const AppGrid = <T,>(props: {
  columns: ColumnConfigMap;             // from the resource config
  overrides?: DeepPartial<ColumnConfigMap>;
  page: Page<T>;                        // ADR-0014 — one page, not a dataset
  listState: ListState;                 // ADR-0034 — the URL is the source of truth
  onListStateChange: (next: ListState) => void;
  meta?: Record<string, unknown>;       // handlers for cellRenderers (table.options.meta)
}) => { /* config + registry → ColumnDef[], useReactTable in manual mode, shadcn <Table> */ };
```

**Server-side operation is the engine's native mode, not a discipline imposed on it.** `useReactTable` runs with `manualPagination: true`, `manualSorting: true`, `manualFiltering: true` and `rowCount: meta.pagination.total`; its sorting, filter and pagination state is fully controlled, derived from the URL search params ADR-0034 validates. The engine computes nothing — a header click fires `onSortingChange`, AppGrid translates the state to the ADR-0014 comma syntax (`-createdAt,email`) and writes the URL, the list query refetches, and the new page renders already ordered. The same loop serves filters (`onColumnFiltersChange` → `filter[field][op]` params) and the pager (`onPaginationChange` → `offset` / `limit`). Declaring the manual flags *is* the honesty this design requires: the table never sorts, filters or paginates the rows it holds, so it cannot imply an operation on the dataset that only touched the visible page.

The controls, all shadcn, all writing URL params:

- **Pagination is a real pager, because the total is real.** ADR-0012 guarantees `meta.pagination` (`offset`, `limit`, `total`) on every list response, and every v1 endpoint returns a genuine filtered count — so the pager renders "21–40 of 143", page jumps, and a page-size select bounded by the contract's `MAX_LIMIT`. Two edge cases are part of the decision, not left to be discovered: `total: null` (the type reserves it for endpoints that opt out of `count(*)`; none do today) renders an open-ended pager with the last-page jump disabled; and a **stranded offset** — deletions shrink the dataset below the current page, the API answers an empty `items` with the true `total` — navigates to the last valid page instead of stranding the operator on an empty grid.
- **Sort arrows appear only where the contract allows.** A column is sortable in config only if its field is in the endpoint's `sortable` allow-list; offering the click and answering it with a `VALIDATION_ERROR` toast would be worse than not offering it.
- **Per-column filter controls exist wherever they can be honest** — for every column whose field and operators `listQuerySchema` allow-lists, with the mapping declared in config: a date column maps a range control to `gt`/`gte`+`lte` on `createdAt` or `lastLoginAt`; a text filter on `email` maps "equals" to `eq` and "contains" to `like` with the operator's `%`/`_`/`\` escaped before wrapping in `%…%` — ADR-0014 does not escape `like` patterns because the client writes them on purpose, so a UI that writes them on the operator's behalf must escape what the operator typed. A column outside the allow-lists gets no filter control at all.
- **The toolbar carries the rest**: a `q` input (debounced) where the endpoint is `searchable`; a status `Select` emitting `filter[status]=…` / `filter[status][in]=…`; a "show deleted" toggle on the users list emitting `filter[deletedAt][null]=false`. Toolbar and column controls are the same primitives from the same design system — there is no seam between "grid UI" and "app UI".

The config-versus-contract agreement is testable rather than trusted: ADR-0036's unit tier runs each config's sortable and filterable declarations through the actual contract schema (`listStaffQuery.safeParse({ sort: "email" })`), so a column the API would reject fails a test before it fails an operator.

**Row actions are a named cellRenderer, handlers come from `table.options.meta`.** `rowActions` (edit / delete / reset password) reads its handlers from the table `meta` the feature passes into `AppGrid`. Entities supply config, features supply behaviour — the config stays serializable and the same renderer serves every resource.

**Registry entries stay resource-agnostic**, which is what lets them live in `shared/` under ADR-0032's rule that shared code has no domain knowledge: `rolesList` renders string-array badges, `statusBadge` a coloured enum label — nothing in `shared/grid` knows what a staff member is. An entry that needs a resource's semantics is not a registry entry; it belongs to the entity or feature that knows them.

**What is deliberately not built until a need names it**: column resizing, reordering, pinning, grid-level keyboard navigation, virtualisation. TanStack Table supports the first three as headless state — adding one later is additive AppGrid work, not a migration — and virtualisation is pointless under a contract that caps a page at `MAX_LIMIT` rows. This is the recorded trade against a component-library grid: those ergonomics arrive built-in there, and §Alternatives says why that bargain was declined.

Theming needs no decision at all: the table is shadcn markup, so ADR-0031's tokens, dark mode and density apply to it the way they apply to a `Card`. There is no second theming system to bridge.

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
- **Validation is the API's own schema.** `useForm({ resolver: zodResolver(createStaffBody), … })` — the *same* `@repo/contracts` schema the API validates with (ADR-0011/0023), so client and server cannot drift: a password rule tightened in contracts tightens the form in the same commit. Server-side field errors arrive as an `ApiClientError` (ADR-0033) whose `details` name field paths; the submit handler maps them back onto RHF via `setError(path, { type: "server", message })`, so a rule only the server can check (duplicate email) still lands next to the field. Unmapped errors follow ADR-0034's operation-level policy.
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

- **Two registries to maintain** — grid (formatters, cellRenderers) and field components. That is a feature, not a tax: the registries *are* the finite UI vocabulary, every entry is named and unit-testable in isolation, and a reviewer can read the whole vocabulary in two files.
- **AppGrid and AppFormInput are unit-testable against configs** (ADR-0036): feed a config, assert the resolved column defs or the rendered field — no API, no browser. The config-versus-contract tests (sortable/filterable through `listQuerySchema`, field maps against the request schemas' keys) turn "the config lies about the API" into a red test.
- **The grid renders a real, semantic `<table>`.** ADR-0036's role-and-label discipline works on it directly — `getByRole("table")`, `columnheader`, `row` — where a virtualised div-grid needs test seams. The accessibility posture and the testing posture are the same posture.
- **Adding a resource is config + entity hooks + thin pages.** Declare the `ResourceConfig`, wire the ADR-0034 query/mutations, compose two pages of JSX. That sequence is the checklist of a future `new-resource-ui` skill, the way `/new-api-module` encodes ADR-0009's.
- **The dependency footprint is one headless engine.** `@tanstack/react-table` is small, ships no styles and no DOM of its own, and sits in `apps/admin` (the machinery's home), not in `@repo/ui` — the design-system package keeps shipping markup primitives only. It is also the third TanStack library in the stack, which is a maintenance-cadence bet this repository has now placed three times, knowingly.
- **The manual flags cost features a client grid would fake**: no client-side quick-filter across the dataset, no local sort of "everything". Operators get exactly what the API can answer, and the URL (ADR-0034) reproduces any view they are looking at.
- **Grid ergonomics are pay-as-you-go.** Column resize/reorder/pin and grid keyboard navigation are not present on day one and each arrives as deliberate AppGrid work when a need names it. That is the flip side of declining a component-library grid, and it is the consequence most likely to trigger this ADR's revisit clause.
- shadcn `Field` primitives being form-engine-agnostic means the RHF choice is contained in the adapters: swapping the form engine later would rewrite one registry, not every page.

## Alternatives considered

- **Hand-written grids and forms per page.** Fine at two resources, and genuinely simpler for the first one. Rejected because the blueprint exists for N: the tenth copy-pasted page is where labels, disabled states and error wiring quietly diverge, and no test notices.
- **AG Grid (Community, and Enterprise's server-side row model).** The first draft of this ADR chose AG Grid CE, and the reversal is worth recording in full. CE (MIT, v36, React 19 since 34.3.0) ships only the client-side and infinite row models, and every server-driven property this design needs had to be imposed on it against its grain: a no-op comparator so sort clicks would not reorder the visible page, a suppressed pagination panel that could only ever report "page 1 of 1" over one server page, a filter-model translation layer, a Theming API bridge to the ADR-0031 tokens, and a virtualised non-semantic DOM that fights ADR-0036's role-query discipline. Its native server-side path in CE — the Infinite Row Model datasource, where `getRows` receives the sort and filter models and the native pager works — fails on state ownership instead: an imperative fetch path that bypasses TanStack Query (mutations would call `refreshInfiniteCache()` on a grid instance rather than invalidating keys) and list state held in the grid rather than the URL, demanding bidirectional synchronisation exactly where ADR-0034 puts a single owner. The Enterprise server-side row model is the fullest version of the right data model, behind a commercial license a starter repository cannot assume. What AG Grid genuinely offers over the chosen design — built-in column resize/reorder/pin, keyboard navigation, virtualisation at scales the contract's `MAX_LIMIT` precludes — is exactly what §Decision defers until a need names it; a future resource that demands those ergonomics economically is the named problem that would supersede this ADR, and this entry is where its author starts.
- **JSON-schema form generators (react-jsonschema-form, uniforms).** The fullest version of config-driven — and they own the markup and styling, which is precisely what the ADR-0031 shadcn approach exists to own. Surrendering the `Field` composition to a generator's theme layer buys automation at the cost of the design system.
- **Functions directly in config** (a `format: (v) => …` per column). More convenient for exactly one week; kills serializability, diffing and deep-merged overrides, and makes the UI vocabulary unbounded. The registry indirection is the price of configs that are data.
- **shadcn's legacy `<Form>` wrapper.** Coupled to RHF's context shape and superseded upstream by the `Field` primitives ADR-0031 already ships. Building new machinery on a deprecated composition would be adopting technical debt at birth.
