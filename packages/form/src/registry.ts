import type { FieldComponentKey } from "@repo/resource";

import {
  CheckboxField,
  InputField,
  MultiCheckboxField,
  SelectField,
  SwitchField,
  TextareaField,
  type FieldAdapter,
} from "./fields";

/**
 * The form's whole UI vocabulary (ADR-0035 §The form half).
 *
 * The same bargain the grid registry makes: a config carries the key
 * `"multiCheckbox"`, this map carries the component, and `FieldComponentKey`
 * being a declared union means a typo is a compile error rather than a silently
 * missing control — while `satisfies` means a key with no adapter is one too.
 *
 * The vocabulary is deliberately finite. A field that genuinely does not fit
 * one of these is not a reason to widen the map with a one-off: ADR-0035's
 * escape hatch is to compose `Controller` + the `Field` primitives by hand
 * inside the same provider, which keeps a bespoke control first-class instead
 * of contorting it into a registry entry every other form then inherits.
 */
export const fieldRegistry = {
  input: InputField,
  textarea: TextareaField,
  select: SelectField,
  checkbox: CheckboxField,
  switch: SwitchField,
  multiCheckbox: MultiCheckboxField,
} as const satisfies Record<FieldComponentKey, FieldAdapter>;

export type FieldRegistry = typeof fieldRegistry;
