import type { ReactNode } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";

import type { FieldConfigMap, FieldVariant } from "@/shared/resource/types";
import { Button, FieldGroup, FieldSet, Spinner } from "@/shared/ui";

import { AppFormProvider } from "./context";
import { AppFormError } from "./form-error";

/**
 * Everything a config-driven form is, minus the shell around it (ADR-0035,
 * ADR-0040).
 *
 * This was the inside of `AppFormDialog` until `D4.2` gave a record three
 * possible shells — a dialog, a right-side drawer and a standalone page. The
 * ADR's requirement is that all three render **the same form**, and the cheapest
 * way to make that true rather than intended is for there to be one form: the
 * shells differ in what they wrap this in, and in nothing else.
 *
 * What it owns is the part every resource repeats identically:
 *
 * - the two providers (ADR-0035 §Two contexts, one join point), mounted once;
 * - two of the three halves of the **submit lock** — the `FieldSet disabled`
 *   with `aria-busy` that catches anything unregistered, including a bespoke
 *   field composed through the escape hatch, and the button's loading state.
 *   The third is `useForm({ disabled })`, which belongs to the caller because
 *   the caller creates the form; a frame cannot retrofit it.
 * - `AppFormError`, so the failure `applyServerErrors` could not land on a
 *   field is never rendered to nobody.
 *
 * What it does **not** own is layout: `children` is the caller's JSX, placing
 * `AppFormInput`s in whatever columns and groups the form wants. ADR-0035 draws
 * that line — "config declares *what* a field is; *where* it renders is the
 * page's JSX" — and a frame that read the field map to decide what to render
 * would be the form DSL that ADR forbids.
 */

/**
 * `TSubmitted` defaults to `TValues`, and the two differ exactly when a form's
 * **state is not its request body** (**amended D3.7 → D3.8**).
 *
 * That is not the common case and was not the case at all until `D3.8`: a body
 * whose fields are all required — `createStaffBody` — is held by the controls
 * as-is. A body with *optional* fields is not, because "the operator left this
 * blank" has to arrive as an absent key and no control can hold absence. Such a
 * form resolves through a transform, RHF types that with its third parameter,
 * and this frame has to carry the pair or the caller is forced into a cast that
 * asserts away the very distinction the transform exists to make.
 */
export interface AppFormFrameProps<
  TValues extends FieldValues,
  TSubmitted extends FieldValues = TValues,
> {
  /** The form the caller built, with `disabled` already tied to `isPending`. */
  readonly form: UseFormReturn<TValues, unknown, TSubmitted>;
  readonly fields: FieldConfigMap;
  readonly variant: FieldVariant;
  /** What the form *sends*, which the resolver may have transformed. */
  readonly onSubmit: (values: TSubmitted) => void | Promise<void>;
  readonly isPending: boolean;
  /** The `AppFormInput`s, arranged however this form wants them. */
  readonly children: ReactNode;
  /**
   * The shell's own footer, holding {@link AppFormActions}.
   *
   * Passed in rather than rendered here because a dialog, a sheet and a page
   * space their footers differently, and it has to be *inside* the `<form>` and
   * inside the locked `FieldSet` — a submit button outside the lock is a submit
   * button that works while the fields are frozen.
   */
  readonly footer: ReactNode;
}

export const AppFormFrame = <
  TValues extends FieldValues,
  TSubmitted extends FieldValues = TValues,
>({
  form,
  fields,
  variant,
  onSubmit,
  isPending,
  children,
  footer,
}: AppFormFrameProps<TValues, TSubmitted>) => (
  <AppFormProvider fields={fields} variant={variant} form={form}>
    {/*
     * `noValidate`: validation is the contracts schema through `zodResolver`,
     * and the browser's own bubbles would answer a different question in a
     * different voice — and stop the submit before the schema that client and
     * server share ever ran (ADR-0035).
     */}
    <form
      noValidate
      onSubmit={(event) => {
        void form.handleSubmit(onSubmit)(event);
      }}
    >
      <FieldSet disabled={isPending} aria-busy={isPending}>
        <FieldGroup>
          {children}
          <AppFormError />
        </FieldGroup>

        {footer}
      </FieldSet>
    </form>
  </AppFormProvider>
);

/**
 * Cancel and submit, identical in all three shells.
 *
 * The pair is a component rather than duplicated JSX for the same reason the
 * frame is: "the same form in three shells" (ADR-0040) has to include the two
 * controls an operator actually reaches for, or the drawer quietly grows a
 * differently-worded button.
 */
export const AppFormActions = ({
  onCancel,
  isPending,
  submitLabel,
  canSubmit = true,
}: {
  readonly onCancel: () => void;
  readonly isPending: boolean;
  readonly submitLabel: string;
  /** `false` while there is nothing worth submitting — an untouched edit. */
  readonly canSubmit?: boolean;
}) => (
  <>
    <Button type="button" variant="outline" onClick={onCancel}>
      Cancel
    </Button>
    <Button type="submit" disabled={!canSubmit}>
      {isPending ? <Spinner /> : null}
      {submitLabel}
    </Button>
  </>
);
