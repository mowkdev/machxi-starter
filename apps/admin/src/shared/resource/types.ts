import type { ErrorCode, FilterOp } from "@repo/contracts";

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
 * passes one straight through. The object form is for the times the stored
 * value and the shown label genuinely differ.
 */
export type OptionConfig =
  string | { readonly value: string; readonly label: string };

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
      readonly placeholder?: string;
    }
  | {
      /** A select over an allow-listed enum. */
      readonly kind: "enum";
      readonly op: Extract<FilterOp, "eq" | "in">;
      readonly options: readonly OptionConfig[];
      readonly placeholder?: string;
    }
  | {
      /** A date range, written as two comparisons on the same field. */
      readonly kind: "dateRange";
      readonly from: Extract<FilterOp, "gt" | "gte">;
      readonly to: Extract<FilterOp, "lt" | "lte">;
    }
  | {
      /**
       * A checkbox over a nullability question — `filter[deletedAt][null]=false`
       * on the users list.
       *
       * `value` is what the box writes when it is checked; unchecked clears the
       * filter rather than writing the opposite, because "no opinion" and "only
       * the live ones" are the same request to an endpoint whose default scope
       * already hides them (ADR-0014, step-9 amendment).
       *
       * **This is a scope switch, not an additive filter** (D3.8). It once read
       * "show deleted users" here, which is what one would want and is not what
       * the endpoint does: `null: false` compiles to `deleted_at is not null`,
       * and the users repository drops its default live-only scope as soon as a
       * filter names `deletedAt` — so checking the box *replaces* the live rows
       * with the deleted ones. `label` is the config's to get right, and it is
       * the one part of a config no schema can check, so it is the one part
       * worth reading twice.
       */
      readonly kind: "presence";
      readonly op: Extract<FilterOp, "null">;
      readonly value: boolean;
      readonly label: string;
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
      readonly label: string;
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
      readonly label: string;
      readonly op: Extract<FilterOp, "null">;
      readonly value: boolean;
    };

/** One column of a resource's grid. */
export interface ColumnConfig {
  readonly header: string;
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
  /** For per-usage overrides: drop the column without editing the resource. */
  readonly hidden?: boolean;
}

/**
 * A resource's columns, in render order.
 *
 * Declaration order is the column order: `Object.entries` walks string keys in
 * insertion order, so the config reads top-to-bottom the way the table reads
 * left-to-right, and reordering columns is reordering lines.
 */
export type ColumnConfigMap = Readonly<Record<string, ColumnConfig>>;

/** One field of a resource's forms. */
export interface FieldConfig {
  readonly label: string;
  /** A `fieldRegistry` key. */
  readonly component: FieldComponentKey;
  readonly description?: string;
  readonly placeholder?: string;
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

/** A resource's form fields. */
export type FieldConfigMap = Readonly<Record<string, FieldConfig>>;

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
}

/**
 * One resource, declared once (ADR-0035).
 *
 * Columns and fields together, so the staff table and the staff form cannot
 * disagree about what a staff member is. Configs are written `as const satisfies
 * ResourceConfig`, which keeps the literal key types for
 * {@link createAppFormInput} while still checking the shape.
 */
export interface ResourceConfig {
  readonly name: string;
  /** How the grid behaves (ADR-0040 opens it; ADR-0038 fills it out). */
  readonly grid?: GridConfig;
  readonly columns: ColumnConfigMap;
  readonly fields: FieldConfigMap;
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
   */
  readonly errorFields?: Readonly<Partial<Record<ErrorCode, string>>>;
}

/**
 * Per-usage column overrides.
 *
 * One level deep is enough — a usage overrides a column's own keys, never the
 * inside of a `filter` — and stopping there keeps the merge a rule anyone can
 * predict rather than a deep-merge whose behaviour has to be looked up.
 */
export type ColumnOverrides = Readonly<Record<string, Partial<ColumnConfig>>>;
