import type { ErrorCode, FilterOp } from "@repo/contracts";

import type { TranslationKey } from "@repo/i18n";

/**
 * The `ResourceConfig` vocabulary (ADR-0035).
 *
 * The rule the whole file exists to serve: **a config is data.** Names, labels,
 * initial values, and registry *keys* — never functions. That is what keeps
 * configs diffable, snapshottable and mergeable, and what keeps the UI
 * vocabulary finite: every key below resolves through a named registry, so a
 * typo is a compile error rather than a blank cell.
 *
 * **The key unions are declared here, and the registries satisfy them.** The
 * first attempt ran the dependency the other way — `keyof typeof gridRegistry`
 * — which inferred the vocabulary from the implementation and left a cycle
 * (registry → adapters → this file → registry) that was safe only for as long
 * as nobody added a runtime `const` to this module. Declaring the vocabulary
 * and checking implementations against it costs one extra line when a key is
 * added, and buys two things: there is no cycle to be careful about, and a key
 * declared with no implementation is a compile error where it used to be
 * inexpressible.
 *
 * **Since `D7.4`, every operator-facing string here is a {@link TranslationKey}
 * rather than a sentence** (ADR-0046 §7), and the rule above is what made that
 * cheap: *a key is data*. A config still diffs, snapshots and deep-merges,
 * nothing in it is a function, and `as const satisfies ResourceConfig` now also
 * checks that every key exists in the `en` catalogue — the same compile-time
 * property the registry names have had since D3, extended to the words. The
 * rendering machinery resolves them through a translator over every namespace
 * (`useKeyT`), which is what keeps `shared/grid` from ever learning a resource
 * name.
 */

/** A `gridRegistry.formatters` key: a cell value rendered as text. */
export type FormatterKey = "date" | "dateTime";

/** A `gridRegistry.cellRenderers` key: a cell rendered as its own component. */
export type CellRendererKey = "rowActions" | "statusBadge" | "rolesList";

/** A `fieldRegistry` key: which control a form field is. */
export type FieldComponentKey =
  "input" | "textarea" | "select" | "checkbox" | "switch" | "multiCheckbox";

/**
 * Which form a field appears in. Absent from a field's `variants` means every
 * one of them.
 *
 * `create` and `edit` are the resource's own pair. **Amended D3.7:** `action`
 * is what a form over a *sub-resource* renders under — the administrative
 * password reset (ADR-0027), and the profile's change-password in `D3.9`. Those
 * bodies are not attributes of the resource, so their field map is neither a
 * create nor an edit of one, and rendering them as `"create"` was a claim the
 * vocabulary could not honestly make. No field in such a map declares
 * `variants` at all, so this exists to be *named* rather than to filter.
 */
export type FieldVariant = "create" | "edit" | "action";

/**
 * A choice in a `select` or `multiCheckbox`, or in an enum filter control.
 *
 * A bare string is the common case — the contracts enums (`STAFF_ROLES`,
 * `USER_STATUSES`) are readonly string tuples, and ADR-0035's own example
 * passes one straight through. **A bare string keeps being the common case
 * after `D7.4`**, and deliberately: its label is looked up under
 * `common:options.<value>`, so a config still names the contracts tuple and
 * ADR-0023's "declared once" property is not copied into a list of labels that
 * a new enum member would silently fall out of.
 *
 * The object form is for the times the stored value and the shown label
 * genuinely differ, and its `label` is a key like every other piece of config
 * copy (ADR-0046 §7).
 */
export type OptionConfig =
  string | { readonly value: string; readonly label: TranslationKey };

/**
 * Props a registry component may be given from config.
 *
 * Deliberately primitives only: `{ type: "email" }` is data, a render prop is
 * not, and widening this to `unknown` would reopen the door the no-functions
 * rule closes.
 */
export type ComponentProps = Readonly<
  Record<string, string | number | boolean>
>;

/**
 * A filter control on a column.
 *
 * `kind` picks the control; the remaining keys say which ADR-0014 operators it
 * writes. A column gets one of these **only if `listQuerySchema` allow-lists
 * the field and those operators** for its endpoint — offering a control the API
 * answers with a `VALIDATION_ERROR` would be worse than offering none, which is
 * why ADR-0035 has the config-versus-contract tests check exactly this pairing.
 */
export type FilterControlConfig =
  | {
      /** A text box. `eq` matches exactly; `like` wraps the escaped term in `%…%`. */
      readonly kind: "text";
      readonly op: Extract<FilterOp, "eq" | "like">;
      readonly placeholder?: TranslationKey;
    }
  | {
      /** A select over an allow-listed enum. */
      readonly kind: "enum";
      readonly op: Extract<FilterOp, "eq" | "in">;
      readonly options: readonly OptionConfig[];
      readonly placeholder?: TranslationKey;
    }
  | {
      /** A date range, written as two comparisons on the same field. */
      readonly kind: "dateRange";
      readonly from: Extract<FilterOp, "gt" | "gte">;
      readonly to: Extract<FilterOp, "lt" | "lte">;
    }
  | {
      /**
       * A checkbox over a nullability question, in a column's header dialog.
       *
       * **No resource declares one today** (`D4.6`). The app's only nullability
       * question is the users grid's `deletedAt`, and `D4.4` made it a toolbar
       * *stance* — the same kind, in {@link HotFilterConfig} — because it is
       * pressed and released many times a session rather than composed. `D4.6`
       * then dropped the duplicate control this kind provided, so what remains
       * here is the vocabulary for the day a resource wants a nullability
       * question that belongs in a header rather than in the toolbar. The demo
       * fixture and the hot-filter tests keep it exercised.
       *
       * `value` is what the box writes when it is checked; unchecked clears the
       * filter rather than writing the opposite, because "no opinion" and "only
       * the live ones" are the same request to an endpoint whose default scope
       * already hides them (ADR-0014, step-9 amendment).
       *
       * **This is a scope switch, not an additive filter** (D3.8), and the
       * reasoning belongs to the kind wherever it renders. It once read "show
       * deleted users", which is what one would want and is not what the
       * endpoint does: `null: false` compiles to `deleted_at is not null`, and
       * the users repository drops its default live-only scope as soon as a
       * filter names `deletedAt` — so pressing it *replaces* the live rows with
       * the deleted ones. `label` is the config's to get right, and it is the
       * one part of a config no schema can check, so it is the one part worth
       * reading twice.
       */
      readonly kind: "presence";
      readonly op: Extract<FilterOp, "null">;
      readonly value: boolean;
      readonly label: TranslationKey;
    };

/**
 * A **hot filter** — a stance, one press away (ADR-0039, `D4.4`).
 *
 * Some filters are compositions and some are stances. "Active staff",
 * "editors", "deleted only" are pressed and released many times a session, and
 * routing them through a header dialog taxes the most-used filters with the
 * ceremony built for the least-used ones. A resource names those, in config,
 * and they render as button groups in the toolbar.
 *
 * **This is a third writer of the same state, not a second mechanism.** A press
 * produces the same {@link Filter} shape and navigates through the same
 * `withFilters` channel with its own field as `owned`, and its pressed state is
 * derived from the URL — so a hot filter and the same field's header dialog
 * cannot disagree: they are two views of one entry.
 *
 * **Two kinds, deliberately.** `text` and `dateRange` are excluded: a button is
 * a *choice*, not a composition surface, and those two belong to the dialogs.
 * The escape hatch for anything outside this vocabulary is ADR-0038's
 * `toolbarStart`, which composes `withFilters` by hand — config for the
 * declarable, JSX for the bespoke.
 *
 * The same honesty rule as {@link FilterControlConfig}: a hot filter may be
 * declared only where `listQuerySchema` allow-lists the field and the operator,
 * and each resource's config test runs these through the actual contract.
 */
export type HotFilterConfig =
  | {
      /** A segmented group over an allow-listed enum. */
      readonly kind: "enum";
      readonly field: string;
      /** Names the group for assistive technology; not shown as a legend. */
      readonly label: TranslationKey;
      /**
       * `eq` is single-select with an implicit "All" — pressing the active
       * option releases it. `in` is multi-toggle, accumulating into one
       * `filter[field][in]`.
       */
      readonly op: Extract<FilterOp, "eq" | "in">;
      readonly options: readonly OptionConfig[];
    }
  | {
      /**
       * A single toggle over a nullability question — the users grid's
       * "Deleted only".
       *
       * `value` is what a pressed button writes; releasing clears the filter
       * rather than writing the opposite, for the reason
       * {@link FilterControlConfig}'s `presence` records: "no opinion" and "only
       * the live ones" are the same request.
       */
      readonly kind: "presence";
      readonly field: string;
      readonly label: TranslationKey;
      readonly op: Extract<FilterOp, "null">;
      readonly value: boolean;
    };

/** One column of a resource's grid. */
export interface ColumnConfig {
  readonly header: TranslationKey;
  /**
   * Renders a sort control in the header. Set it only where the endpoint's
   * `sortable` allow-list contains the field.
   */
  readonly sortable?: boolean;
  /** A `gridRegistry.formatters` key: the value rendered as text. */
  readonly formatter?: FormatterKey;
  /**
   * A `gridRegistry.cellRenderers` key. Takes precedence over `formatter` —
   * a renderer receives the raw value and decides its own presentation.
   */
  readonly cellRenderer?: CellRendererKey;
  /** The filter control for this column, if the contract allows one. */
  readonly filter?: FilterControlConfig;
  /** Numeric and action columns read better trailing. */
  readonly align?: "start" | "end";
  /**
   * The cell holds **data rather than prose**, and takes the mono face
   * (ADR-0054 §4, `D11.2`): identifiers, emails, timestamps and counts.
   *
   * A flag on the column rather than a guess in the grid, because only the
   * resource knows what its own field *is* — `@repo/grid` may hold no domain
   * knowledge (ADR-0049), and "email" is domain knowledge. It stays plain
   * serializable data, so a per-usage override can still turn it off.
   */
  readonly mono?: boolean;
  /** For per-usage overrides: drop the column without editing the resource. */
  readonly hidden?: boolean;
}

/**
 * A row, or a request body, as the machinery reads one when it does not know
 * the resource (ADR-0063 §Consequences).
 *
 * It is the default type argument of every map below, so a consumer that
 * genuinely has no row type — `@repo/grid`'s internals, a per-usage override,
 * the customer app's fields-only maps — writes `ColumnConfigMap` exactly as it
 * did before this record and gets the old, string-keyed shape. The type
 * travels at the *door*, which is the same rule the `shared/` slices follow.
 */
export type UnknownShape = Readonly<Record<string, unknown>>;

/**
 * The one column key that is not a field of the row (ADR-0063 §1, amended).
 *
 * A column renders `accessorKey: name` against the row, so a column key that
 * is not a key of the row can only ever render an empty cell — which is the
 * defect ADR-0063 exists to make a compile error. The exception is the grid's
 * own chrome: the row-actions column reads the row rather than a value of it,
 * so it belongs to no field and every resource declares it under this name.
 *
 * **The runtime discriminator is still {@link ColumnConfig.cellRenderer}**, not
 * this name — `isStructuralColumn` in `@repo/grid` asks which renderer a column
 * declares, and it keeps answering for a per-usage override that adds one. What
 * this reserves is the *key*, because a mapped type cannot ask a question about
 * a property's value.
 */
export type StructuralColumnKey = "actions";

/**
 * A resource's columns, in render order, **keyed by the row** (ADR-0063 §1).
 *
 * Declaration order is the column order: `Object.entries` walks string keys in
 * insertion order, so the config reads top-to-bottom the way the table reads
 * left-to-right, and reordering columns is reordering lines.
 *
 * Every key is a key of `TRow` — the resource type in `@repo/contracts` — or
 * the reserved {@link StructuralColumnKey}. That is ADR-0035's promise moved
 * from a test into the compiler: a misspelt column used to compile, render a
 * header and an empty cell, and now it is an error on the line that wrote it.
 * The keys stay optional, because a resource shows the columns it chooses.
 */
export type ColumnConfigMap<TRow = UnknownShape> = {
  readonly [
    K in Extract<keyof TRow, string> | StructuralColumnKey
  ]?: ColumnConfig;
};

/** One field of a resource's forms. */
export interface FieldConfig {
  readonly label: TranslationKey;
  /** A `fieldRegistry` key. */
  readonly component: FieldComponentKey;
  readonly description?: TranslationKey;
  readonly placeholder?: TranslationKey;
  /** Choices for `select` and `multiCheckbox`. */
  readonly options?: readonly OptionConfig[];
  /** The create form's starting value. */
  readonly initialValue?: string | number | boolean | readonly string[] | null;
  /** Which forms the field appears in. Absent means both. */
  readonly variants?: readonly FieldVariant[];
  /**
   * An emptied control submits `null` rather than `""`.
   *
   * The contracts' nullable names (`updateUserBody`) make "clear it" a legal
   * request that `""` cannot express, so the adapter has to know which one the
   * field means.
   */
  readonly nullable?: boolean;
  /** Passed to the registry component — `{ type: "password" }` and the like. */
  readonly props?: ComponentProps;
}

/**
 * A resource's form fields, **keyed by the request bodies** (ADR-0063 §1).
 *
 * `TBodies` is the *intersection* of the create and update bodies, because
 * `keyof (A & B)` is `keyof A | keyof B` — a field belongs to the form if
 * either body has a place for it, and which of the two is the `variants`
 * question rather than this one. A field the endpoint dropped is now a compile
 * error rather than a control the API answers with a `VALIDATION_ERROR`.
 */
export type FieldConfigMap<TBodies = UnknownShape> = {
  readonly [K in Extract<keyof TBodies, string>]?: FieldConfig;
};

/** The names a resource's forms may declare — one body's keys, or both. */
export type FieldName<TBodies> = Extract<keyof TBodies, string>;

/**
 * Which shell a resource's record form is composed in (ADR-0040).
 *
 * A string key rather than a component, because the ADR-0035 rule stands: a
 * config is data, and "which shell" is exactly the finite, serializable
 * vocabulary that rule exists for. The three differ only in the frame — the
 * form inside is the same config-driven form — and the **URL is identical
 * across all three**, so changing this line breaks no link, no bookmark and no
 * test that navigates by path.
 */
export type EditSurfaceKey = "dialog" | "drawer" | "page";

/**
 * What a resource's grid surface *offers* (ADR-0038, `D4.3`).
 *
 * Flags and plain data only — the configs-are-data rule of ADR-0035 stands
 * unamended. **A capability declares that the surface offers something; the
 * handler still arrives at the usage site**, as a prop or through `meta`, and a
 * function never enters config.
 *
 * **Said honestly: these are UI capabilities, not authorization.** The API's
 * guards (ADR-0019) remain the enforcement, and `canDelete` says "this
 * resource's grid offers deletion", not "this operator may delete". ADR-0042 is
 * the other half of that sentence: a discretionary affordance renders only when
 * the capability *and* {@link can} are both true, and the conjunction happens
 * once per screen through `allowedCapabilities` rather than at each button.
 *
 * It is split out of {@link GridConfig} rather than merged into it because the
 * grid reads exactly this much: `editSurface` is a routing decision the record
 * routes make (ADR-0040) and `AppGrid` has no business seeing it.
 */
export interface GridCapabilities {
  /** A checkbox column and selection state (ADR-0038). */
  readonly selectable?: boolean;
  /** A Create affordance in the toolbar. */
  readonly canCreate?: boolean;
  /** An `edit` entry in the row menu. */
  readonly canEdit?: boolean;
  /** A `delete` entry in the row menu. */
  readonly canDelete?: boolean;
  /**
   * A bulk Delete in the toolbar. **Requires `selectable`** — without a
   * selection there is nothing for the button to act on, so the combination is
   * dead data and each resource's config test refuses it rather than letting
   * the toolbar quietly render nothing.
   */
  readonly canBulkDelete?: boolean;
  /**
   * Page-size options for the pager, bounded by `MAX_LIMIT` at render.
   *
   * It joined the capability block after `AppGrid` grew the equivalent prop in
   * D3.8's URL-default fix: the resource is where a page size is *declared*,
   * and the pager is where it is offered.
   */
  readonly pageSizes?: readonly number[];
}

/**
 * How a resource's grid behaves, as opposed to what its columns are.
 *
 * Opened by `D4.2` with the one key ADR-0040 needs and filled out by `D4.3`
 * with ADR-0038's capability flags; ADR-0039 and ADR-0041 have their own keys
 * after that. It is a block rather than a top-level key so those arrive as
 * additions here instead of as more siblings of `columns`.
 */
export interface GridConfig extends GridCapabilities {
  /**
   * Which shell `new` and `$id` render in. Absent means `"dialog"` — D3's
   * behaviour, so adopting ADR-0040 changes no resource's look until its own
   * config says otherwise.
   */
  readonly editSurface?: EditSurfaceKey;
  /**
   * The stances this resource offers one press away (ADR-0039, `D4.4`).
   *
   * Optional, and a grid that declares none renders none — which is the whole
   * of "pluggable". It sits on {@link GridConfig} rather than on
   * {@link GridCapabilities} for the same reason `editSurface` does: ADR-0042
   * narrows *capabilities* by role, and a hot filter is a filter, not an
   * affordance anybody's role decides about. The page hands it to `AppGrid`
   * beside `columns`, which is what it is — declared filter surface.
   */
  readonly hotFilters?: readonly HotFilterConfig[];
  /**
   * Whether the endpoint implements ADR-0014's `q` search (ADR-0063 §2).
   *
   * It was a bare `searchable` prop on `AppGrid` at each of the two call sites
   * until `D14.10`, with a comment naming the endpoint it was a claim about —
   * which is the shape of every other claim this block holds, and the one shape
   * {@link assertConfigMatchesContract} could not check, because a prop in JSX
   * is not something a config test can read. Declared here it is checked in
   * both directions: a resource that offers the search box has an endpoint that
   * accepts `q`, and one that does not is one whose endpoint refuses it.
   *
   * Not a {@link GridCapabilities} flag, deliberately: ADR-0042 narrows
   * capabilities by the operator's role, and nobody's role decides whether a
   * list may be searched — the same reasoning `hotFilters` sits here under.
   */
  readonly searchable?: boolean;
}

/**
 * One resource, declared once (ADR-0035).
 *
 * Columns and fields together, so the staff table and the staff form cannot
 * disagree about what a staff member is. Configs are written `as const satisfies
 * ResourceConfig<…>`, which keeps the literal key types for
 * {@link createAppFormInput} while still checking the shape.
 *
 * **The three type arguments are the contract** (ADR-0063 §1, `D14.10`): the
 * resource type the endpoint returns and the two request bodies, taken straight
 * from `@repo/contracts`. So the config's vocabulary *is* the contract's
 * vocabulary by construction rather than by a per-resource test, and the two
 * halves ADR-0035 could only check at runtime — a column that is not a field of
 * the row, a field neither body has room for — are compile errors. What no type
 * can check is which of those the *endpoint* allow-lists for sorting and
 * filtering; that is {@link assertConfigMatchesContract}'s half.
 *
 * They default to {@link UnknownShape} so that a reader which genuinely does
 * not know the resource — `editSurfaceOf`, a grid rendering somebody else's
 * columns — still names the type without arguments.
 */
export interface ResourceConfig<
  TRow = UnknownShape,
  TCreate = UnknownShape,
  TUpdate = UnknownShape,
> {
  readonly name: string;
  /** How the grid behaves (ADR-0040 opens it; ADR-0038 fills it out). */
  readonly grid?: GridConfig;
  readonly columns: ColumnConfigMap<TRow>;
  readonly fields: FieldConfigMap<TCreate & TUpdate>;
  /**
   * Domain error codes that mean "this field", for the failures the API
   * reports without a path (**amended D3.7**).
   *
   * `STAFF_EMAIL_TAKEN` is a `409` whose `details` are empty — the conflict is
   * about the request, not about a zod issue — but the operator's question is
   * "what do I change?" and the answer is a box on screen. It belongs *on* the
   * config rather than beside it for the reason columns and fields do: a
   * resource declares itself once, and a consumer that had to import two
   * symbols would eventually import one.
   *
   * Data, like everything else here — a `Partial` map of code to field name,
   * never a callback. {@link applyServerErrors} consumes it.
   *
   * The name is one of the bodies' since `D14.10`: an entry pointing at a box
   * neither form draws would put the API's sentence nowhere.
   */
  readonly errorFields?: Readonly<
    Partial<Record<ErrorCode, FieldName<TCreate & TUpdate>>>
  >;
}

/**
 * Per-usage column overrides.
 *
 * One level deep is enough — a usage overrides a column's own keys, never the
 * inside of a `filter` — and stopping there keeps the merge a rule anyone can
 * predict rather than a deep-merge whose behaviour has to be looked up.
 *
 * Keyed by the row like {@link ColumnConfigMap} since `D14.10`, and for the
 * same reason: an override naming a column the resource does not declare is
 * ignored at runtime, which is the failure that used to be silent.
 */
export type ColumnOverrides<TRow = UnknownShape> = {
  readonly [
    K in Extract<keyof TRow, string> | StructuralColumnKey
  ]?: Partial<ColumnConfig>;
};
