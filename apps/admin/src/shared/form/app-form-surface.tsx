import type { ReactNode } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";

import type {
  EditSurfaceKey,
  FieldConfigMap,
  FieldVariant,
} from "@/shared/resource/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui";

import { AppFormDialog } from "./app-form-dialog";
import { AppFormActions, AppFormFrame } from "./app-form-frame";

/**
 * One footer layout for the drawer and the page, matching the dialog's.
 *
 * `SheetFooter` was the obvious choice for the drawer and is the wrong one:
 * shadcn styles it `flex-col`, so the two buttons stack full-width and Cancel
 * sits *above* Save — a different visual priority from the same form in a
 * modal, which is the drift "the same form in three shells" (ADR-0040) exists
 * to prevent. Found by looking at it; nothing in a class list says a footer is
 * a column. `DialogFooter` already resolves to this row on any non-tiny
 * viewport, so all three now read the same.
 */
const FOOTER = "mt-6 flex justify-end gap-2";

/**
 * A record being composed or edited, in whichever shell its resource declared
 * (ADR-0040).
 *
 * **The surface is a routed one, so closing is a navigation.** There is no
 * `open` prop: this component is mounted exactly while its route matches, which
 * is the whole point of ADR-0040 — the URL is the state, Back closes the
 * surface, and a reload restores it. `onClose` is the caller's `navigate` back
 * to the list, and every path to it converges here: Cancel, Escape, the overlay
 * click and the post-save close.
 *
 * **The URL is identical across all three shells**, which is what makes
 * `editSurface` a one-line config change rather than a migration: no link, no
 * bookmark and no test that navigates by path knows which of these rendered.
 *
 * The submit lock reaches all three (ADR-0040 §Details pinned): the dialog and
 * the drawer refuse to dismiss while the mutation is in flight, and the page
 * has no dismissal to refuse — only its Cancel button, which is inside the
 * locked `FieldSet` like every other control.
 */
export interface AppFormSurfaceProps<
  TValues extends FieldValues,
  TSubmitted extends FieldValues = TValues,
> {
  /** Which shell, from the resource's own config. */
  readonly surface: EditSurfaceKey;
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
  /** Back to the list. A navigation, never a `setState`. */
  readonly onClose: () => void;
  /** The `AppFormInput`s, arranged however this form wants them. */
  readonly children: ReactNode;
}

export const AppFormSurface = <
  TValues extends FieldValues,
  TSubmitted extends FieldValues = TValues,
>({
  surface,
  onClose,
  ...props
}: AppFormSurfaceProps<TValues, TSubmitted>) => {
  const {
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
  } = props;

  if (surface === "dialog") {
    /*
     * Delegated rather than re-implemented: the modal shell already exists for
     * the ephemeral ceremonies, and two Dialogs with slightly different padding
     * is exactly the drift ADR-0035 built one frame to prevent. `open` is
     * always `true` — the route match is what opens it — and every dismissal
     * resolves to the same navigation.
     */
    return (
      <AppFormDialog
        open
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
        {...props}
      />
    );
  }

  const actions = (
    <AppFormActions
      onCancel={onClose}
      isPending={isPending}
      submitLabel={submitLabel}
      canSubmit={canSubmit}
    />
  );

  const frame = (footer: ReactNode) => (
    <AppFormFrame
      form={form}
      fields={fields}
      variant={variant}
      onSubmit={onSubmit}
      isPending={isPending}
      footer={footer}
    >
      {children}
    </AppFormFrame>
  );

  if (surface === "drawer") {
    return (
      <Sheet
        open
        onOpenChange={(next) => {
          // The dialog's rule, carried to the Sheet (ADR-0040): a form that
          // locks its fields and then lets the operator close the window has
          // not locked anything.
          if (!next && !isPending) onClose();
        }}
      >
        {/*
         * `side="right"` and a width the grid survives: the drawer's argument
         * over the dialog is that the list stays legible beside it, which a
         * full-bleed sheet would give away.
         */}
        <SheetContent
          side="right"
          className="w-full gap-0 overflow-y-auto sm:max-w-lg"
        >
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            {description === undefined ? null : (
              <SheetDescription>{description}</SheetDescription>
            )}
          </SheetHeader>

          <div className="px-4 pb-4">
            {frame(<div className={FOOTER}>{actions}</div>)}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  /*
   * The page. No overlay, no dismissal gesture, and — because the list route
   * unmounts the grid for this surface — nothing behind it to preserve context
   * with. `max-w-2xl` because a form stretched across a wide monitor is a form
   * whose labels and controls have lost each other.
   */
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description === undefined ? null : (
          <CardDescription>{description}</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {frame(<div className={FOOTER}>{actions}</div>)}
      </CardContent>
    </Card>
  );
};
