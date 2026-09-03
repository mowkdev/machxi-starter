# ADR-0063: Typed resource configs and generators (supersedes ADR-0035 in part — a delta)

- Status: accepted
- Date: 2026-09-02
- Supersedes: [ADR-0035](0035-config-driven-resource-ui.md) (delta: `ResourceConfig` carries its types, and the per-resource claims suites become one shared assertion)

> Written 2026-09-02 by `/scope` for D14 ([`docs/plan/0014-starter-hardening.md`](../plan/0014-starter-hardening.md)). `proposed` at writing; **accepted 2026-09-03 at `D14.10`'s head**, where [ADR-0035](0035-config-driven-resource-ui.md) moves to `superseded by` — a delta under [ADR-0050](0050-adr-lifecycle-and-verification.md) rule 1: every decision 0035 makes about *what* a config is (data, never functions; one declaration for the table and both forms; registry keys; validation from the contracts schemas) stands as written and is in force as part of this record. What changes is that the config's keys are now checked against the contract by the compiler, and that the agreement no type can reach is asserted once rather than per resource. §3 (the generators) builds at `D14.11`, in the same window.

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

**Amended 2026-09-03 (`D14.10`) — five corrections the build made to the sketch above.** The decision is unchanged; what follows is what it actually compiles to.

1. **`ColumnConfig` and `GridConfig` take no type parameters.** The sketch writes `ColumnConfig<TRow, K>` and `GridConfig<TRow>`, and neither has anything to do with them: every member of both is a translation key, a registry key, an operator or a flag — nothing in either mentions the *value* of a cell, which is the only thing `K` could have named. Type parameters no member uses are noise the next reader has to disprove. The keying happens where it means something, in the two maps.
2. **One reserved column key, `actions`.** A column resolves against the row by `accessorKey`, so a key that is not a key of the row can only render an empty cell — with one exception, the row-actions column, which reads the row rather than a value of it (ADR-0041 calls it structural). A mapped type cannot ask a question about a property's *value*, so the key is reserved instead: `keyof TRow | "actions"`. `isStructuralColumn` keeps discriminating on the renderer at runtime, which is what a per-usage override still needs.
3. **Every parameter defaults to `UnknownShape`** (`Readonly<Record<string, unknown>>`), so a reader that genuinely has no row — `editSurfaceOf`, `@repo/grid`'s internals, `mergeColumns`, the customer app's fields-only maps — names the type with no arguments and gets exactly the string-keyed shape it had before. This is §Consequences' "the type travels at the door" made mechanical rather than a convention.
4. **`AppGrid` takes its columns as `ColumnConfigMap<NoInfer<TRow>>`.** The row is what the *data* says it is: without `NoInfer` a config and a page that disagreed would infer a union and typecheck, which is the disagreement the parameter exists to catch.
5. **A cell renderer does not receive `TRow`, and must not.** The renderers are `gridRegistry` components — `rowActions`, `statusBadge`, `rolesList` — shared by every resource, and ADR-0049 forbids `@repo/grid` holding domain knowledge; a registry keyed by a resource's row type would be a different design (a per-resource renderer map) and a worse one. They keep taking `GridRow`. The half of that sentence which is true is the form's: `<StaffFormInput fieldName="…" />` now accepts exactly the body's keys, and it needed no change to do it — the keys it reads are the config's, and the config's are the contract's.

### 2. One shared claims assertion, not one per resource

`@repo/resource` exports

```ts
assertConfigMatchesContract(config, { listQuery, createBody, updateBody }): void
```

which checks what the hand-written suite checks and the type system cannot: that every `sortable` column is sortable in the endpoint's `listQuery`, that every declared filter is spelled the way that endpoint's filter spec accepts, that `q` is only offered where the endpoint is searchable, and that every field belongs to a body — with the negative controls, because a column that claims a sort it does not have costs an operator a broken feature.

A resource's config test becomes a few lines calling it. The 367-line suite is deleted, not moved: its claims are the assertion's, and the ones the generic type now makes are nobody's.

**Amended 2026-09-03 (`D14.10`) — the signature, and where `q` had to move.** The bag takes two more entries, and both are the same shape of concession: what a package cannot know about an app.

- **`samples`** — values the contract has an opinion about, per field. A body cannot be assembled at all without values that parse, and `email` and `password` are policies rather than words. Fixture data, not a claim: what is under test is the *set* of fields.
- **`optionLabelled`** — whether the app's catalogue labels an option value. `common:options.<value>` is composed at runtime so that a config never restates an enum ADR-0023 declares once, and a missing entry degrades to `humanize`: a plausible English word in grey, which is the kind of gap a review reads straight past. The dictionary belongs to an app (ADR-0046 §13), so the app answers the question and the assertion asks it.

**`searchable` moved into `grid`.** This section's `q` claim was uncheckable as written: `q` was a bare `searchable` prop on `AppGrid` at each of the two call sites, and a prop in JSX is not something a config test can read. It is a claim about the endpoint like every other line in that block, so it is declared there and both pages read it — and the claim is now checked in **both** directions, because a search box over an endpoint with no `q` returns an unfiltered page and looks like a working one. It is not a `GridCapabilities` flag: ADR-0042 narrows capabilities by role, and nobody's role decides whether a list may be searched. (That is the delta on ADR-0035's `grid` block; ADR-0038's capability flags are untouched.)

**What this deliberately stops checking, and where those claims went.** Two of the deleted suites' assertions are not in the shared one and are not anybody's now, which is a decision rather than an oversight:

- **The `grid` block's exact key set.** Each suite asserted `Object.keys(grid).sort()` against a literal list, to catch "a capability added here without a decision about who may use it" (ADR-0038/0042). Half of it is the type's: `as const satisfies ResourceConfig<…>` is an object literal, so a key outside `GridConfig` — a smuggled `role`, a `permission` — is an excess-property error. The other half was never a test's to make: whether a *new* `GridConfig` key is a capability that ADR-0042 must narrow is a decision, and the place it is taken is a record like this one. `searchable` is the first key added since, and the paragraph above is where that decision is written.
- **The `presence`/`deletedAt` reasoning and the "no roles control" note.** Both are properties of one resource, stated where they belong — in that config's own comments — and both are now enforced by the type: `deletedAt` is a column and not a field because `UserResource` has it and neither body does, and `roles` likewise.

**And it throws rather than asserting.** `assertConfigMatchesContract` collects every violation and raises one `Error` naming the resource. That keeps it in `@repo/resource`'s ordinary source — the package has no test framework among its dependencies and this buys it none — and reporting all of them at once matters: failing on the first hides the second, and a config being brought up to a changed contract usually has more than one. The assertion's own negative controls live in `packages/resource/src/__tests__/contract.test.ts`, against a fake endpoint, because a real contract cannot be made to refuse things.

### 3. Generators with `turbo gen`

Scaffolding becomes a command. `turbo/generators/config.ts` with Handlebars templates, run as `pnpm turbo gen`, two generators:

- **`api-module`** — routes, controller, service, repository, schemas, mapper, errors, the module `index.ts`, unit and integration test stubs, the contracts folder and the Postman folder stub. The composition-root and router edits — `core/container.ts`, `routes/*.router.ts` — are printed as instructions or applied by the generator; either is acceptable, printing them is the safer default.
- **`resource-screen`** — the entity slice, the feature slice, the thin page, the record routes, both locale JSONs, the MSW handler and the tests, with the cross-cutting edits (the namespace list, the resource map, the policy table, the sidebar) printed as instructions.

`/new-api-module` and `/new-resource-ui` **run the generator first** and then describe only what the generator cannot do — the domain decisions, the guard choice, the copy. And the templates become authoritative:

> **The templates are the description of a module and of a resource screen. When the shape changes, the template changes in the same step.**

A shape that is only in a skill document decays; a shape that is in a template is exercised the next time anyone adds a resource.

**Amended 2026-09-04 (`D14.11`) — two items move from the generated list to the printed one, and the reason is the same for both.** The bullets above put "integration test stubs" and "the Postman folder stub" among what `api-module` writes. It writes neither, and should not: an integration test is written against endpoints that exist, and a stub asserting five requests nobody has decided on is a suite that must be deleted before it can be useful — the opposite of what ADR-0021 asks a supertest file to be. The Postman folder is the same shape of guess, and it is already what §3's own rule calls a decision. Both are printed as instructions instead, beside the migration, the composition root and the router mount. What `api-module` generates is the contract folder, the table, the eight module files, the **unit** test and the ADR-0060 §3 index test — the last of which needs no edit at all, because it reads the repository's own `ColumnMap` against the allow-lists rather than restating either.

**And a tension `D14.11` found rather than settled, recorded here because the next tenant table meets it.** ADR-0067 §1 wants every index on a tenant-owned table led by `organization_id`; ADR-0060 §3's checker (`indexCoverage` in `@repo/db/testing`) attributes an index to its **leading** column only, deliberately — it was asked for a set comparison, not a planner. So under tenant-led indexes alone, every `sortable` column reads as uncovered and the generated index test reddens. The template therefore declares both sets, and says so where it declares them: the tenant-led composites are what a tenant query reads, the bare `(column, id)` pairs are what the rule can see. Which of the two gives way is ADR-0067's to decide when D15 builds it — a generator settling it by dropping whichever set is inconvenient would be a scaffold quietly overruling a record.

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
