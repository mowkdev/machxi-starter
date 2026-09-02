# ADR-0063: Typed resource configs and generators (supersedes ADR-0035 in part — a delta)

- Status: proposed
- Date: 2026-09-02

> Written 2026-09-02 by `/scope` for D14 ([`docs/plan/0014-starter-hardening.md`](../plan/0014-starter-hardening.md)). `proposed` at writing; accepted at the head of the step that builds it.

## Context

[ADR-0035](0035-config-driven-resource-ui.md) (config-driven resource UI) decided that a resource declares itself once — columns and fields together — so the table and the form cannot disagree about what a staff member is. The agreement it makes is between the config and the **contract**, and that half is not typed.

`ResourceConfig` is not generic. `columns` and `fields` are `Readonly<Record<string, …>>`, the grid's row type is `GridRow = Record<string, unknown>`, and `createAppFormInput` checks a field name against the *config's* own keys rather than against the body schema. So a config is internally consistent and externally unchecked: a misspelt column key compiles, renders a header and an empty cell, and a field that no longer exists in `createStaffBody` compiles and renders a control the API rejects. What stands in for the type is a hand-written per-resource suite — `apps/admin/src/entities/staff/__tests__/staff.config.test.ts`, some 367 lines — which is a good test and states its claim plainly ("every `sortable` and every `filter` in the config is an assertion about `listStaffQuery`"). Its weakness is that it must be **remembered**: nothing makes the next resource write one, and its 367 lines are the price of asking.

The second cost is the scaffolding itself. One resource screen is about two dozen new files plus a handful of edited ones — an entity slice, a feature slice, a thin page, the record routes, both locale catalogues, an MSW handler, the tests, and edits to the namespace list, the resource map, the policy table and the sidebar. An API module is eight files plus the container and router wiring, the contracts and the Postman folder. None of it is generated. The only description of the shape is the Claude skills `/new-resource-ui` and `/new-api-module`, which is a description a human team cannot execute and an agent executes by copying whichever resource it read last.

## Decision

### 1. `ResourceConfig` carries its types

```ts
export interface ResourceConfig<TRow, TCreate, TUpdate> {
  readonly name: string;
  readonly grid?: GridConfig<TRow>;
  readonly columns: { readonly [K in keyof TRow]?: ColumnConfig<TRow, K> };
  readonly fields: {
    readonly [K in keyof TCreate | keyof TUpdate]?: FieldConfig;
  };
  readonly errorFields?: Readonly<Partial<Record<ErrorCode, keyof TCreate | keyof TUpdate>>>;
}
```

Columns are keyed by `keyof TRow`, fields by the union of the two bodies' keys. The row type is inferred from the resource type in `@repo/contracts` and the bodies from their zod schemas (`z.infer<typeof createStaffBody>`), so the config's vocabulary is the contract's vocabulary by construction, not by a test.

`createAppFormInput` and `AppGrid` carry the row type through: a cell renderer receives `TRow`, and `<StaffFormInput fieldName="…" />` accepts exactly the body's keys. Both shipped configs — staff and user — migrate. **`as const satisfies ResourceConfig<…>` remains the authoring form**, which is what keeps the literal key types ADR-0035 relies on.

### 2. One shared claims assertion, not one per resource

`@repo/resource` exports

```ts
assertConfigMatchesContract(config, { listQuery, createBody, updateBody }): void
```

which checks what the hand-written suite checks and the type system cannot: that every `sortable` column is sortable in the endpoint's `listQuery`, that every declared filter is spelled the way that endpoint's filter spec accepts, that `q` is only offered where the endpoint is searchable, and that every field belongs to a body — with the negative controls, because a column that claims a sort it does not have costs an operator a broken feature.

A resource's config test becomes a few lines calling it. The 367-line suite is deleted, not moved: its claims are the assertion's, and the ones the generic type now makes are nobody's.

### 3. Generators with `turbo gen`

Scaffolding becomes a command. `turbo/generators/config.ts` with Handlebars templates, run as `pnpm turbo gen`, two generators:

- **`api-module`** — routes, controller, service, repository, schemas, mapper, errors, the module `index.ts`, unit and integration test stubs, the contracts folder and the Postman folder stub. The composition-root and router edits — `core/container.ts`, `routes/*.router.ts` — are printed as instructions or applied by the generator; either is acceptable, printing them is the safer default.
- **`resource-screen`** — the entity slice, the feature slice, the thin page, the record routes, both locale JSONs, the MSW handler and the tests, with the cross-cutting edits (the namespace list, the resource map, the policy table, the sidebar) printed as instructions.

`/new-api-module` and `/new-resource-ui` **run the generator first** and then describe only what the generator cannot do — the domain decisions, the guard choice, the copy. And the templates become authoritative:

> **The templates are the description of a module and of a resource screen. When the shape changes, the template changes in the same step.**

A shape that is only in a skill document decays; a shape that is in a template is exercised the next time anyone adds a resource.

## Consequences

- A misspelt column or a field the body dropped is a compile error, which is where ADR-0035's promise was always meant to be checked; a per-resource suite stops being the thing standing between the config and the contract.
- Making the config generic touches `@repo/resource`, `@repo/grid` and `@repo/form` together, and both apps' configs with them. It is a wide, mechanical diff and the type checker is the reviewer.
- `GridRow = Record<string, unknown>` stays as the machinery's internal row type where the grid genuinely does not know the row; the type travels at the door, which is the same rule the `shared/` doors follow.
- A new resource costs a command plus the domain work, so the blueprint is forkable by a team, not only by an agent that has read the repository.
- The generators are code that can rot. The mitigation is the rule above plus the fact that every new resource runs them; a template nobody runs is a template nobody trusts.

## Alternatives considered

- **A runtime assertion only, keys left as strings.** Cheaper, and the typo still compiles and still renders a blank column until someone runs the test — the failure this record is about.
- **plop or hygen.** Equivalent capability, one more tool; `turbo gen` is Turborepo's own and is already installed.
- **Skills only, no generators.** The current state. It works when an agent with the whole repository in context writes the code, and it asks a human team to hand-write two dozen files correctly.
- **Code generation from the contracts (a full CRUD screen from a zod schema).** Tempting and too far: the configs carry translation keys, capability flags and edit-surface choices that are design decisions, not derivations. The generator scaffolds; the config still says what the screen is.
