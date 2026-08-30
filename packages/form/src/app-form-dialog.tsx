import type { ReactNode } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";

import type { FieldConfigMap, FieldVariant } from "@repo/resource";
import { DialogFooter } from "@repo/ui/components/dialog";
import { FieldGroup } from "@repo/ui/components/field";
import {
  RecordSurface,
  type RecordSurfaceColumnProps,
} from "@repo/ui/compositions/record-surface";

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
 * **Rebuilt over `RecordSurface` at `D8.11`**, the last of the three shells to
 * adopt the container, and the one that gains the most by it: this file owned
 * a `DialogContent` with **no `className` and therefore no viewport bound at
 * all**. A form longer than the screen grew the modal *past* the viewport
 * instead of scrolling inside it — and because the element is centred by
 * transform, it grew past both ends at once, putting the title and the Save
 * button off-screen with no way to reach either. That is a different defect
 * from the drawer's, which did scroll and scrolled its own title away; this
 * one had no scroll element anywhere. The container supplies both halves of
 * the fix on `DialogContent` itself (ADR-0048 §4): `max-h-[calc(100svh-2rem)]`
 * to bound it, and the `grid-rows-[minmax(0,1fr)]` track that lets the bound
 * reach the column, so the body is what scrolls and the title and footer stay.
 *
 * The one thing this shell owns beyond the frame: **it cannot be dismissed
 * while the request is in flight.** A form that locks its fields and then lets
 * the operator close the window has not locked anything. That used to be an
 * `if (!isPending)` guard around the caller's `onOpenChange`; it is
 * `dismissible={!isPending}` now, which is the same refusal made structural —
 * the container withholds `onOpenChange` from the Radix root, prevents Escape
 * and the overlay, and withholds the corner button rather than rendering one
 * that refuses the close it offers. So there is no route out left for this
 * shell to have to catch, and the button hiding while pending is what the
 * drawer already does.
 *
 * The controlled mount stays: `open` and `onOpenChange` are the caller's, and
 * that is the difference from {@link AppFormSurface}, whose route match is
 * what opens it.
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
}: AppFormDialogProps<TValues, TSubmitted>) => {
  /*
   * The inversion (ADR-0048 §4), identical to the drawer's and the page's in
   * `app-form-surface.tsx`: `RecordSurface` owns the geometry and asks for the
   * element that carries it, and the frame supplies its `<form>` — so the
   * `<form>` wraps header, body and footer, `type="submit"` works from a fixed
   * footer, and that footer reads form state through the same context the
   * fields do.
   */
  const column = ({ className, children: rows }: RecordSurfaceColumnProps) => (
    <AppFormFrame
      className={className}
      fields={fields}
      form={form}
      isPending={isPending}
      onSubmit={onSubmit}
      variant={variant}
    >
      {rows}
    </AppFormFrame>
  );

  return (
    <RecordSurface
      column={column}
      dismissible={!isPending}
      footer={
        /*
         * **`DialogFooter`, not the `FOOTER` row the other two shells use.**
         * They reach for a hand-written row because `SheetFooter` is
         * `flex-col` and would stack the buttons full-width with Cancel above
         * Save; `DialogFooter` is the shape they are matching, so the dialog
         * keeping its own is what makes all three read the same rather than a
         * divergence. It also keeps the one thing the hand-written row does
         * not have: `flex-col-reverse` below `sm`, which is real behaviour on
         * a phone and nothing in jsdom would have noticed going.
         *
         * **The `mt-12` retires at `D11.5`** (ADR-0054 §7), for the reason
         * `app-form-surface.tsx` gives beside its own row: the footer is a
         * 64px band on `--muted` now, so the fields-to-footer distance is the
         * band's height and its rule rather than a margin inside it. `w-full`
         * because the band is `flex items-center` and would otherwise size
         * this row to its content, dropping the full-width stack this element
         * keeps below `sm`.
         */
        <DialogFooter className="w-full">
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
      onOpenChange={onOpenChange}
      open={open}
      title={title}
      variant="dialog"
      {...(description === undefined ? {} : { description })}
    >
      {/*
       * The container's **body**, not the frame's children: since `D8.9` the
       * frame's children are the three rows. `AppFormError` stays inside
       * `FieldGroup`, spaced by that element's own gap, so the body row is a
       * single child needing no wrapper and no gap of its own.
       *
       * That gap is `gap-5` since `D11.5` — §7's 20px field stack, written
       * here because `FieldGroup`'s own `gap-7` (28px) is the CLI's and
       * ADR-0047 keeps the primitive byte-identical. It spaces the error from
       * the last field too, which is the same category of distance.
       */}
      <FieldGroup className="gap-5">
        {children}
        <AppFormError />
      </FieldGroup>
    </RecordSurface>
  );
};
