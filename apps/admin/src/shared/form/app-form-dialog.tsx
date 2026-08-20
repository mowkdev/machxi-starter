import type { ReactNode } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";

import type { FieldConfigMap, FieldVariant } from "@/shared/resource/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui";

import { AppFormActions, AppFormFrame } from "./app-form-frame";

/**
 * A config-driven form in a modal (ADR-0035).
 *
 * Since `D4.2` this is one of three shells around the same
 * {@link AppFormFrame}, and the only one that is still opened and closed by a
 * caller holding state: the *record* forms became routes (ADR-0040), so what
 * still arrives here is the ephemeral half — the administrative password reset
 * and the profile's change-password, ceremonies that must not be deep-linkable.
 * {@link AppFormSurface} is the routed door to the same frame, and it renders
 * this component when a resource's `editSurface` is `"dialog"`.
 *
 * The one thing this shell owns beyond the frame: **it cannot be dismissed
 * while the request is in flight.** A form that locks its fields and then lets
 * the operator close the window has not locked anything.
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

      <AppFormFrame
        form={form}
        fields={fields}
        variant={variant}
        onSubmit={onSubmit}
        isPending={isPending}
        footer={
          <DialogFooter className="mt-6">
            <AppFormActions
              onCancel={() => {
                onOpenChange(false);
              }}
              isPending={isPending}
              submitLabel={submitLabel}
              canSubmit={canSubmit}
            />
          </DialogFooter>
        }
      >
        {children}
      </AppFormFrame>
    </DialogContent>
  </Dialog>
);
