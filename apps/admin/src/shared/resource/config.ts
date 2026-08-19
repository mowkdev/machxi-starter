import type {
  ColumnConfig,
  ColumnConfigMap,
  ColumnOverrides,
  FieldConfig,
  FieldConfigMap,
  FieldVariant,
  OptionConfig,
} from "./types";

/**
 * The runtime half of the config vocabulary (ADR-0035).
 *
 * Plain functions over plain data, which is the whole return on the
 * no-functions-in-config rule: two configs can be merged because they are
 * objects, and every helper here is unit-testable without a DOM.
 */

/** An option in the one shape components consume. */
export interface ResolvedOption {
  readonly value: string;
  readonly label: string;
}

/**
 * `super_admin` → `Super admin`.
 *
 * Resource-agnostic on purpose (ADR-0032 keeps domain knowledge out of
 * `shared`): it is a rule about snake_case identifiers, not about roles. A
 * config whose label needs to differ from this says so with the object form of
 * {@link OptionConfig}.
 */
export const humanize = (value: string): string => {
  const spaced = value.replace(/[_-]+/g, " ").trim();

  return spaced === ""
    ? value
    : spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

export const resolveOption = (option: OptionConfig): ResolvedOption =>
  typeof option === "string"
    ? { value: option, label: humanize(option) }
    : option;

export const resolveOptions = (
  options: readonly OptionConfig[] | undefined,
): readonly ResolvedOption[] => (options ?? []).map(resolveOption);

/**
 * A resource's columns with a usage's overrides applied, in declaration order,
 * with hidden columns dropped.
 *
 * Data merges — that is what the no-functions rule buys. Two column configs
 * combine by key with the override winning; two functions could not have been
 * combined at all, which is the argument §Decision makes and this function is
 * the cash value of.
 *
 * An override naming a column the resource does not declare is ignored rather
 * than added: overrides adjust a resource's columns, they do not invent them,
 * and an invented one would have no field to read.
 */
export const mergeColumns = (
  columns: ColumnConfigMap,
  overrides: ColumnOverrides = {},
): readonly (readonly [string, ColumnConfig])[] =>
  Object.entries(columns)
    .map(
      ([name, column]) =>
        [name, { ...column, ...overrides[name] }] as readonly [
          string,
          ColumnConfig,
        ],
    )
    .filter(([, column]) => column.hidden !== true);

/** Whether a field belongs to the form being rendered. */
export const isInVariant = (
  field: FieldConfig,
  variant: FieldVariant,
): boolean => field.variants === undefined || field.variants.includes(variant);

/** A variant's fields, in declaration order. */
export const fieldsForVariant = (
  fields: FieldConfigMap,
  variant: FieldVariant,
): readonly (readonly [string, FieldConfig])[] =>
  Object.entries(fields).filter(([, field]) => isInVariant(field, variant));

/**
 * `defaultValues` for a create form, from the config's `initialValue`s.
 *
 * A field with no `initialValue` starts `""` rather than `undefined`, because
 * React would otherwise take the control as uncontrolled on the first render
 * and warn — loudly, and for every form — the moment the operator types.
 *
 * The empty value has to match the *control*, not just be falsy: a
 * `multiCheckbox` holds an array and the two boolean controls hold a boolean.
 * Seeding a `switch` with `""` renders it unchecked (its adapter tests
 * `value === true`) and then submits `""` into a `z.boolean()` — a form that
 * looks right and fails validation on a field the operator never touched.
 */
export const initialValuesFor = (
  fields: FieldConfigMap,
  variant: FieldVariant,
): Record<string, unknown> =>
  Object.fromEntries(
    fieldsForVariant(fields, variant).map(([name, field]) => [
      name,
      field.initialValue === undefined
        ? emptyValueFor(field.component)
        : field.initialValue,
    ]),
  );

const emptyValueFor = (
  component: FieldConfig["component"],
): string | boolean | readonly string[] => {
  switch (component) {
    case "multiCheckbox":
      return [];
    case "checkbox":
    case "switch":
      return false;
    default:
      return "";
  }
};

/**
 * The subset of a submitted form the operator actually changed.
 *
 * ADR-0035 prunes edit submits to RHF's `dirtyFields` so the contracts'
 * "provide at least one field to update" refinement measures a real edit rather
 * than a re-send of every value the form was seeded with — which would also
 * overwrite a field a second admin changed in the meantime.
 */
export const dirtyValuesOf = <TValues extends Record<string, unknown>>(
  values: TValues,
  dirtyFields: Readonly<Record<string, unknown>>,
): Partial<TValues> =>
  Object.fromEntries(
    Object.entries(values).filter(([name]) => isDirtyFlag(dirtyFields[name])),
  ) as Partial<TValues>;

/**
 * Whether RHF's `dirtyFields` entry for a field means "the operator changed
 * this".
 *
 * It is not always `true`: RHF mirrors the *value's* shape, so an array field
 * (`roles`, a `multiCheckbox`) is flagged as an array of booleans and a nested
 * object as an object of them. Testing `=== true` looks right, passes on every
 * scalar field, and silently drops exactly the array fields — which for an edit
 * form means the one change the operator made never reaches the request.
 */
const isDirtyFlag = (flag: unknown): boolean => {
  if (flag === true) return true;
  if (Array.isArray(flag)) return flag.some(isDirtyFlag);
  if (typeof flag === "object" && flag !== null)
    return Object.values(flag).some(isDirtyFlag);

  return false;
};
