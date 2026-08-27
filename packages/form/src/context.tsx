import { createContext, useContext, type ReactNode } from "react";
import {
  FormProvider,
  type FieldValues,
  type UseFormReturn,
} from "react-hook-form";

import {
  isInVariant,
  type FieldConfig,
  type FieldConfigMap,
  type FieldVariant,
} from "@repo/resource";

/**
 * The config half of a form's context (ADR-0035 §Two contexts, one join point).
 *
 * **Two providers, nested, deliberately separate.** RHF's own `FormProvider`
 * carries form *state* — what the value of `email` is; this one carries the
 * resource's field configuration and which variant is on screen — what `email`
 * *is*. They answer different questions, and merging them would couple the
 * config machinery to RHF's context shape for no gain, which is exactly the
 * coupling that made shadcn's legacy `<Form>` wrapper a dead end.
 *
 * They are mounted by one component because a caller has no reason to want one
 * without the other, and forgetting the inner one would fail at the first
 * `AppFormInput` rather than at the provider.
 */

interface AppFormContextValue {
  readonly fields: FieldConfigMap;
  readonly variant: FieldVariant;
}

const AppFormContext = createContext<AppFormContextValue | null>(null);

/**
 * `TSubmitted` carries RHF's transform, and defaults to `TValues` because most
 * forms have none (**amended D3.8** — see `AppFormDialog`). Nothing in here
 * reads either one; the provider only needs to accept the form the caller
 * built, and a two-parameter signature would refuse a transformed one.
 */
export interface AppFormProviderProps<
  TValues extends FieldValues,
  TSubmitted extends FieldValues = TValues,
> {
  readonly fields: FieldConfigMap;
  readonly variant: FieldVariant;
  readonly form: UseFormReturn<TValues, unknown, TSubmitted>;
  readonly children: ReactNode;
}

export const AppFormProvider = <
  TValues extends FieldValues,
  TSubmitted extends FieldValues = TValues,
>({
  fields,
  variant,
  form,
  children,
}: AppFormProviderProps<TValues, TSubmitted>) => (
  <AppFormContext.Provider value={{ fields, variant }}>
    <FormProvider {...form}>{children}</FormProvider>
  </AppFormContext.Provider>
);

export const useAppForm = (): AppFormContextValue => {
  const value = useContext(AppFormContext);

  if (value === null) {
    throw new Error("AppFormInput must be rendered inside <AppFormProvider>");
  }

  return value;
};

/**
 * A field's config, or `null` when it does not belong to this variant.
 *
 * `null` rather than a throw is what lets **one** form component serve both
 * create and edit: the page places every input it might need, and the config's
 * `variants` decides which of them exist on screen. `email` is create-only
 * because `updateStaffBody` deliberately omits it, so the edit form simply does
 * not render it — the config tells the same story as the contract.
 *
 * A name that is in no variant at all is a different matter and throws: that is
 * a typo the compiler could not catch (a raw `AppFormInput` rather than the
 * generated one), and rendering nothing would hide it until someone noticed a
 * missing control.
 */
export const useFieldConfig = (name: string): FieldConfig | null => {
  const { fields, variant } = useAppForm();
  const config = fields[name];

  if (config === undefined) {
    throw new Error(
      `No field "${name}" in this form's config. Declared: ${Object.keys(fields).join(", ")}`,
    );
  }

  return isInVariant(config, variant) ? config : null;
};
