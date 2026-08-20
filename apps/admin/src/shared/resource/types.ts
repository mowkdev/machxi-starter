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
 * One resource, declared once (ADR-0035).
 *
 * Columns and fields together, so the staff table and the staff form cannot
 * disagree about what a staff member is. Configs are written `as const satisfies
 * ResourceConfig`, which keeps the literal key types for
 * {@link createAppFormInput} while still checking the shape.
 */
export interface ResourceConfig {
  readonly name: string;
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
