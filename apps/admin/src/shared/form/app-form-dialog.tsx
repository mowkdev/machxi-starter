import type { ReactNode } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";

import type { FieldConfigMap, FieldVariant } from "@/shared/resource/types";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldGroup,
  FieldSet,
  Spinner,
} from "@/shared/ui";

import { AppFormProvider } from "./context";
import { AppFormError } from "./form-error";

/**
 * The frame a config-driven form is submitted from (ADR-0035).
 *
 * **A frame, not a form DSL, and the distinction is the whole reason this is
 * allowed to exist.** ADR-0035 draws one hard line — "config declares *what* a
 * field is; *where* it renders is the page's JSX", and "the day config grows a
 * `layout` key is the day this ADR needs superseding". Nothing here reads the
 * field map to decide what to render: `children` is the caller's JSX, placing
 * `AppFormInput`s in whatever columns, cards and separators the form wants.
 * What this owns is everything *around* them, which is the part every resource
 * repeats identically:
 *
 * - the two providers (ADR-0035 §Two contexts, one join point), mounted once;
 * - two of the three halves of the **submit lock** — the `FieldSet disabled`
 *   with `aria-busy` that catches anything unregistered, including a bespoke
 *   field composed through the escape hatch, and the button's loading state.
 *   The third is `useForm({ disabled })`, which belongs to the caller because
 *   the caller creates the form; a dialog cannot retrofit it.
 * - `AppFormError`, so the failure `applyServerErrors` could not land on a
 *   field is never rendered to nobody;
 * - the dialog itself, which cannot be dismissed while the request is in
 *   flight — a form that locks its fields and then lets the operator close the
 *   window has not locked anything.
 *
 * It lives in `shared/form` rather than in the first feature that wanted it
 * because ADR-0032 forbids one feature importing another: `staff-manage` and
 * `users-manage` need the same frame, and a copy in each is the drift ADR-0035
 * exists to prevent, one layer up from the fields.
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
export interface AppFormDialogProps<
  TValues extends FieldValues,
  TSubmitted extends FieldValues = TValues,
> {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string;
  /** The form the caller built, with `disabled` already tied to `isPending`. */
  readonly form: UseFormReturn<TValues, unknown, TSubmitted>;
  readonly fields: FieldConfigMap;
  readonly variant: FieldVariant;
  /** What the form *sends*, which the resolver may have transformed. */
  readonly onSubmit: (values: TSubmitted) => void | Promise<void>;
  readonly isPending: boolean;
  readonly submitLabel: string;
  /** `false` while there is nothing worth submitting — an untouched edit. */
  readonly canSubmit?: boolean;
  /** The `AppFormInput`s, arranged however this form wants them. */
  readonly children: ReactNode;
}

export const AppFormDialog = <
  TValues extends FieldValues,
  TSubmitted extends FieldValues = TValues,
>({
  open,
  onOpenChange,
  title,
  description,
  form,
  fields,
  variant,
  onSubmit,
  isPending,
  submitLabel,
  canSubmit = true,
  children,
}: AppFormDialogProps<TValues, TSubmitted>) => (
  <Dialog
    open={open}
    onOpenChange={(next) => {
      // Escape, the overlay and the close button all arrive here. A request in
      // flight is the one time the answer is no: the mutation would land
      // anyway, and its result would have nowhere to be shown.
      if (!isPending) onOpenChange(next);
    }}
  >
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description === undefined ? null : (
          <DialogDescription>{description}</DialogDescription>
        )}
      </DialogHeader>

      <AppFormProvider fields={fields} variant={variant} form={form}>
        {/*
         * `noValidate`: validation is the contracts schema through
         * `zodResolver`, and the browser's own bubbles would answer a different
         * question in a different voice — and stop the submit before the schema
         * that client and server share ever ran (ADR-0035).
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

            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {isPending ? <Spinner /> : null}
                {submitLabel}
              </Button>
            </DialogFooter>
          </FieldSet>
        </form>
      </AppFormProvider>
    </DialogContent>
  </Dialog>
);
