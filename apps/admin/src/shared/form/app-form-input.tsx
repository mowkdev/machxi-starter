import { useId } from "react";
import { Controller, useFormContext } from "react-hook-form";

import type { FieldConfig, FieldConfigMap } from "@/shared/resource/types";

import { useFieldConfig } from "./context";
import { fieldRegistry } from "./registry";

/**
 * The join point (ADR-0035 §The form half).
 *
 * `<AppFormInput fieldName="email" />` reads the field's config from the
 * AppForm context, form state from the RHF context, resolves the config's
 * `component` key through the field registry, and renders. Everything a page
 * has to say about a field is its *name* — the rest was declared once, on the
 * resource.
 *
 * What stays in the page is **layout**: config declares what a field is, the
 * JSX around this component declares where it goes. That line is a rule, not a
 * preference — the day config grows a `layout` key is the day ADR-0035 needs
 * superseding — and it is what keeps this a config-driven form rather than a
 * form DSL.
 */

export interface AppFormInputProps {
  readonly fieldName: string;
  /** Per-usage adjustments to the field's config — a different label, say. */
  readonly overrides?: Partial<FieldConfig>;
}

export const AppFormInput = ({ fieldName, overrides }: AppFormInputProps) => {
  const declared = useFieldConfig(fieldName);
  const { control } = useFormContext();
  /*
   * A generated id rather than the field name. Two forms for the same resource
   * can be on screen at once — an edit dialog over a grid that has a filter row
   * — and duplicate `id`s would point every `<label for>` at whichever control
   * rendered first.
   */
  const id = useId();

  // Not in this variant: the page may place it unconditionally and let the
  // config decide (see `useFieldConfig`).
  if (declared === null) return null;

  const config =
    overrides === undefined ? declared : { ...declared, ...overrides };
  const Adapter = fieldRegistry[config.component];

  return (
    <Controller
      name={fieldName}
      control={control}
      render={({ field, fieldState }) => (
        <Adapter
          id={id}
          config={config}
          field={field}
          fieldState={fieldState}
        />
      )}
    />
  );
};

/**
 * The typed input for one resource's fields.
 *
 * ```ts
 * export const StaffFormInput = createAppFormInput(staffResourceConfig.fields);
 * ```
 *
 * One line in the entity slice, and from then on `<StaffFormInput
 * fieldName="frstName" />` is a **compile error** rather than a control that
 * silently never appears. That is the whole reason resource configs are written
 * `as const`: the literal key types survive, and `keyof` them is a real union.
 *
 * The map is a type-level argument — the component still reads its config from
 * the provider at runtime, so there is exactly one source of field config and
 * this cannot disagree with it.
 */
export const createAppFormInput = <TFields extends FieldConfigMap>(
  fields: TFields,
) => {
  void fields;

  return AppFormInput as (props: {
    readonly fieldName: Extract<keyof TFields, string>;
    readonly overrides?: Partial<FieldConfig>;
  }) => React.ReactNode;
};
