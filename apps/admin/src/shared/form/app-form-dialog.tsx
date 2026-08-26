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
  FieldGroup,
} from "@/shared/ui";

import { AppFormActions, AppFormFrame } from "./app-form-frame";
import { AppFormError } from "./form-error";

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
          /*
           * `mt-12`, not `mt-6`, since `D8.9` — and this shell needs it for
           * the same reason the other two do, even though it has not adopted
           * `RecordSurface` yet. `AppFormFrame`'s `FieldSet` took
           * `display: contents` for all of its call sites at once, so the
           * `flex flex-col gap-6` that supplied the fields-to-footer distance
           * went inert here too. Without this the shipped dialog — the default
           * surface for staff and all three non-routed ceremonies — would have
           * halved that gap from 3rem to 1.5rem. `D8.11` folds this into the
           * container's footer row with the others.
           */
          <DialogFooter className="mt-12">
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
        {/*
         * Wrapped here since `D8.9`, when `AppFormFrame` stopped rendering
         * these itself: its `children` became the container's rows under
         * ADR-0048 §4's inversion. This shell does not adopt the container
         * until `D8.11`, so it keeps the old layout — but it takes the
         * wrapping now, because without it the dialog path would silently
         * lose field grouping and the form-level error for two steps while
         * `check-types` stayed green.
         */}
        <FieldGroup>
          {children}
          <AppFormError />
        </FieldGroup>
      </AppFormFrame>
    </DialogContent>
  </Dialog>
);
