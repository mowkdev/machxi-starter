import { dynamicKey, type TranslateKey } from "@repo/i18n";

import type {
  ColumnConfig,
  ColumnConfigMap,
  ColumnOverrides,
  EditSurfaceKey,
  FieldConfig,
  FieldConfigMap,
  FieldVariant,
  OptionConfig,
  ResourceConfig,
  UnknownShape,
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
 * `shared`): it is a rule about snake_case identifiers, not about roles.
 *
 * **Since `D7.4` it is the fallback rather than the answer**: it is what
 * {@link optionLabel} passes as `defaultValue`, so an enum member with no
 * catalogue entry renders exactly what it rendered before D7 instead of a raw
 * key. That keeps the failure mode of a value added to `@repo/contracts` the
 * one it has always been — a plausible English word in grey — rather than a new
 * one.
 */
export const humanize = (value: string): string => {
  const spaced = value.replace(/[_-]+/g, " ").trim();

  return spaced === ""
    ? value
    : spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

/**
 * The words for an enum value, from `common:options.<value>` (ADR-0046 §7).
 *
 * **One catalogue block for the whole app, not one per resource**, and the
 * reason is that this is also the answer for the two renderers that have no
 * config at all: `StatusBadge` and `RolesList` receive a cell value and
 * nothing else (`shared/grid/cells.tsx`), so a per-config label map could not
 * reach them and the staff grid would read `Active` in a Latvian panel. The
 * values themselves — `active`, `super_admin` — are app-wide vocabulary that
 * belongs to no single slice, which is what `common` is.
 *
 * The key is composed at runtime, which is the one thing D7 admits doing:
 * spelling the members out in each config would copy the contracts tuple that
 * ADR-0023 declares once. See `dynamicKey` for the cost that carries into
 * `D7.6`.
 */
export const optionLabel = (t: TranslateKey, value: string): string =>
  t(dynamicKey(`common:options.${value}`), { defaultValue: humanize(value) });

/**
 * The values a config's options name, with no words attached.
 *
 * Pure, and separated from {@link resolveOptions} at `D7.4` because the two
 * questions stopped being one: "which values may this control write" is
 * answered by the contract and asserted in every config test, and "what do they
 * say on screen" needs a translator. Anything that only needs the first — the
 * hot filters' pressed-state maths, the config-versus-contract suites — takes
 * this and stays a pure function.
 */
export const optionValues = (
  options: readonly OptionConfig[] | undefined,
): readonly string[] =>
  (options ?? []).map((option) =>
    typeof option === "string" ? option : option.value,
  );

export const resolveOption = (
  option: OptionConfig,
  t: TranslateKey,
): ResolvedOption =>
  typeof option === "string"
    ? { value: option, label: optionLabel(t, option) }
    : { value: option.value, label: t(option.label) };

export const resolveOptions = (
  options: readonly OptionConfig[] | undefined,
  t: TranslateKey,
): readonly ResolvedOption[] =>
  (options ?? []).map((option) => resolveOption(option, t));

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
export const mergeColumns = <TRow = UnknownShape>(
  columns: ColumnConfigMap<TRow>,
  overrides: ColumnOverrides<TRow> = {},
): readonly (readonly [string, ColumnConfig])[] =>
  /*
   * Both maps are read through their string-keyed view, which is the one cast
   * this file makes and the reason it makes it: since `D14.10` the argument
   * types are keyed by `TRow` (ADR-0063 §1), and a mapped type over an
   * unresolved type parameter is not an index signature, so `Object.entries`
   * cannot walk one. The keys *are* strings either way — the widening loses no
   * information, and it happens here rather than at every call site.
   */
  Object.entries(columns as Readonly<Record<string, ColumnConfig>>)
    .map(
      ([name, column]) =>
        [
          name,
          {
            ...column,
            ...(overrides as Readonly<Record<string, Partial<ColumnConfig>>>)[
              name
            ],
          },
        ] as readonly [string, ColumnConfig],
    )
    .filter(([, column]) => column.hidden !== true);

/**
 * Which shell this resource composes records in (ADR-0040).
 *
 * One reader for the default, so "absent means dialog" is written down once
 * rather than as a `?? "dialog"` at each of the two call sites that would
 * otherwise have to remember it.
 */
export const editSurfaceOf = (config: ResourceConfig): EditSurfaceKey =>
  config.grid?.editSurface ?? "dialog";

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
  /*
   * `flatMap` rather than `filter`, because the map's values are optional since
   * `D14.10`: it is keyed by the bodies now (ADR-0063 §1) and every key is `?`,
   * so a declared field reads as `FieldConfig | undefined`. Nothing at runtime
   * changed — an absent key was never enumerated — and this is the narrowing
   * that says so.
   */
  Object.entries(fields).flatMap(([name, field]) =>
    field !== undefined && isInVariant(field, variant)
      ? [[name, field] as const]
      : [],
  );

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
