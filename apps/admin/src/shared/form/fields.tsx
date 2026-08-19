/*
 * `react-hooks/refs` off for this file, and only this file.
 *
 * The rule is the React Compiler's, and it is right about `useRef`: reading a
 * ref's value during render is how a component silently fails to update. What
 * it has here is a false positive — RHF's `ControllerRenderProps` is a plain
 * object that happens to carry a `ref` **callback** for the control to attach,
 * not a ref object with a `.current`, and reading `field.value` / `field.name`
 * during render is precisely what the API exists for. Probed rather than
 * assumed: the warning follows the `field` object through every arrangement —
 * direct member access, destructuring, aliased or inline prop types — so there
 * is no spelling of these adapters that satisfies it while still using
 * `Controller`.
 *
 * Scoped to the one file that touches `field`, in the shape ADR-0031
 * §Consequences set for the generated primitives: name the rule at the point of
 * change and say what forced it, so the next reader does not have to re-derive
 * that this was deliberate.
 */
/* eslint-disable react-hooks/refs */
import type {
  ControllerFieldState,
  ControllerRenderProps,
  FieldValues,
} from "react-hook-form";

import { resolveOptions } from "@/shared/resource/config";
import type { FieldConfig } from "@/shared/resource/types";
import {
  Checkbox,
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@/shared/ui";

/**
 * The field adapters (ADR-0035 §The form half).
 *
 * **Every entry is thin, and identical in shape**: the shadcn control composed
 * inside the `Field` primitives — label, description, error and the aria wiring
 * between them in one place (ADR-0031) — driven through RHF's `Controller`.
 *
 * `Controller` uniformly, including for text inputs that `register()` would
 * serve. `Select`, `Checkbox` and `Switch` need it anyway, so using it
 * everywhere means one wiring pattern in this file instead of two, and it
 * isolates re-renders to the field that changed. Uniformity beats
 * micro-optimising the text inputs.
 *
 * The adapters also own the contract-shaped edge cases, which is the honest
 * place for them: a nullable field maps an emptied control to `null`, because
 * "clear my last name" is a legal request (`updateUserBody`) that `""` cannot
 * express.
 */

export interface FieldAdapterProps {
  /** Ties label, control, description and error together. */
  readonly id: string;
  readonly config: FieldConfig;
  readonly field: ControllerRenderProps<FieldValues, string>;
  readonly fieldState: ControllerFieldState;
}

export type FieldAdapter = (props: FieldAdapterProps) => React.ReactNode;

/**
 * The label / description / error frame every adapter renders into.
 *
 * `FieldError` takes the RHF error object directly — one shape in, the
 * `role="alert"` markup out — so no adapter formats a message itself.
 */
const Frame = ({
  id,
  config,
  fieldState,
  children,
  orientation,
}: Pick<FieldAdapterProps, "id" | "config" | "fieldState"> & {
  readonly children: React.ReactNode;
  readonly orientation?: "vertical" | "horizontal";
}) => {
  const invalid = fieldState.invalid;

  return (
    <Field data-invalid={invalid} orientation={orientation}>
      {orientation === "horizontal" ? (
        <>
          {children}
          <FieldContent>
            <FieldLabel htmlFor={id}>{config.label}</FieldLabel>
            {config.description === undefined ? null : (
              <FieldDescription>{config.description}</FieldDescription>
            )}
            <FieldError
              errors={fieldState.error === undefined ? [] : [fieldState.error]}
            />
          </FieldContent>
        </>
      ) : (
        <>
          <FieldLabel htmlFor={id}>{config.label}</FieldLabel>
          {children}
          {config.description === undefined ? null : (
            <FieldDescription>{config.description}</FieldDescription>
          )}
          <FieldError
            errors={fieldState.error === undefined ? [] : [fieldState.error]}
          />
        </>
      )}
    </Field>
  );
};

/** What a text control submits: `null` where the contract allows clearing. */
const emptyAs = (config: FieldConfig, value: string): string | null =>
  config.nullable === true && value === "" ? null : value;

/** `null` and `undefined` both render as an empty control, never as uncontrolled. */
const asText = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value);

export const InputField = ({
  id,
  config,
  field,
  fieldState,
}: FieldAdapterProps) => (
  <Frame id={id} config={config} fieldState={fieldState}>
    <Input
      id={id}
      name={field.name}
      ref={field.ref}
      value={asText(field.value)}
      onChange={(event) => {
        field.onChange(emptyAs(config, event.target.value));
      }}
      onBlur={field.onBlur}
      disabled={field.disabled ?? false}
      placeholder={config.placeholder}
      aria-invalid={fieldState.invalid}
      {...config.props}
    />
  </Frame>
);

export const TextareaField = ({
  id,
  config,
  field,
  fieldState,
}: FieldAdapterProps) => (
  <Frame id={id} config={config} fieldState={fieldState}>
    <Textarea
      id={id}
      name={field.name}
      ref={field.ref}
      value={asText(field.value)}
      onChange={(event) => {
        field.onChange(emptyAs(config, event.target.value));
      }}
      onBlur={field.onBlur}
      disabled={field.disabled ?? false}
      placeholder={config.placeholder}
      aria-invalid={fieldState.invalid}
      {...config.props}
    />
  </Frame>
);

export const SelectField = ({
  id,
  config,
  field,
  fieldState,
}: FieldAdapterProps) => (
  <Frame id={id} config={config} fieldState={fieldState}>
    <Select
      value={asText(field.value)}
      disabled={field.disabled ?? false}
      onValueChange={field.onChange}
    >
      <SelectTrigger
        id={id}
        ref={field.ref}
        onBlur={field.onBlur}
        aria-invalid={fieldState.invalid}
      >
        <SelectValue placeholder={config.placeholder ?? "Select…"} />
      </SelectTrigger>
      <SelectContent>
        {resolveOptions(config.options).map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </Frame>
);

export const CheckboxField = ({
  id,
  config,
  field,
  fieldState,
}: FieldAdapterProps) => (
  <Frame
    id={id}
    config={config}
    fieldState={fieldState}
    orientation="horizontal"
  >
    <Checkbox
      id={id}
      ref={field.ref}
      checked={field.value === true}
      onCheckedChange={(checked) => {
        field.onChange(checked === true);
      }}
      onBlur={field.onBlur}
      disabled={field.disabled ?? false}
      aria-invalid={fieldState.invalid}
    />
  </Frame>
);

export const SwitchField = ({
  id,
  config,
  field,
  fieldState,
}: FieldAdapterProps) => (
  <Frame
    id={id}
    config={config}
    fieldState={fieldState}
    orientation="horizontal"
  >
    <Switch
      id={id}
      ref={field.ref}
      checked={field.value === true}
      onCheckedChange={field.onChange}
      onBlur={field.onBlur}
      disabled={field.disabled ?? false}
      aria-invalid={fieldState.invalid}
    />
  </Frame>
);

/**
 * A set of checkboxes over one array value — roles, permissions.
 *
 * A named `group`, not a labelled input: the set is what carries the field's
 * name and each box carries its own option's, so `getByRole("group", { name:
 * "Roles" })` and `getByRole("checkbox", { name: "Editor" })` both work — the
 * role-and-label discipline ADR-0036 asks of every control, which is also the
 * minimum a screen reader needs to announce this as one field rather than as
 * four loose checkboxes.
 */
export const MultiCheckboxField = ({
  id,
  config,
  field,
  fieldState,
}: FieldAdapterProps) => {
  const selected = Array.isArray(field.value)
    ? (field.value as readonly string[])
    : [];

  const toggle = (value: string, checked: boolean) => {
    field.onChange(
      checked
        ? [...selected, value]
        : selected.filter((entry) => entry !== value),
    );
  };

  return (
    <Field
      data-invalid={fieldState.invalid}
      role="group"
      aria-labelledby={`${id}-legend`}
    >
      <FieldTitle id={`${id}-legend`}>{config.label}</FieldTitle>
      <div className="flex flex-wrap gap-4">
        {resolveOptions(config.options).map((option) => {
          const optionId = `${id}-${option.value}`;

          return (
            <div key={option.value} className="flex items-center gap-2">
              <Checkbox
                id={optionId}
                checked={selected.includes(option.value)}
                onCheckedChange={(checked) => {
                  toggle(option.value, checked === true);
                }}
                disabled={field.disabled ?? false}
              />
              <FieldLabel htmlFor={optionId} className="font-normal">
                {option.label}
              </FieldLabel>
            </div>
          );
        })}
      </div>
      {config.description === undefined ? null : (
        <FieldDescription>{config.description}</FieldDescription>
      )}
      <FieldError
        errors={fieldState.error === undefined ? [] : [fieldState.error]}
      />
    </Field>
  );
};
