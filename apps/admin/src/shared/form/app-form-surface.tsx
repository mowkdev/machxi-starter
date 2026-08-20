import { useBlocker } from "@tanstack/react-router";
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
 * the drawer refuse to dismiss while the mutation is in flight, and the page —
 * which has no dismissal gesture of its own but plenty of ways out of it —
 * blocks the navigation instead. See {@link AppFormPage}.
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

  return (
    <AppFormPage
      title={title}
      {...(description === undefined ? {} : { description })}
      isPending={isPending}
    >
      {frame(<div className={FOOTER}>{actions}</div>)}
    </AppFormPage>
  );
};

/**
 * The page shell — no overlay, and therefore the one that has to block
 * navigation for itself.
 *
 * ADR-0040 §Details pinned says the in-flight rule reaches "the page shell's
 * navigation affordances alike", and the page is the shell where that is not
 * free. A dialog and a drawer own a dismissal gesture and refuse it while a
 * mutation is in flight; a page has no gesture of its own, but it sits inside
 * `_dashboard`, where the sidebar links and the Back button are live ways out.
 * Without the blocker an operator can leave mid-submit, the mutation lands
 * anyway, and its failure has no form left to render in — which is exactly the
 * outcome the other two shells refuse.
 *
 * It is a separate component because the blocker is a hook and
 * {@link AppFormSurface} returns early for the other two surfaces; a hook after
 * a conditional return is not a hook. `enableBeforeUnload: false`
 * deliberately: this guards an in-app navigation, and a browser's own "leave
 * site?" prompt is a different, uglier conversation that nothing here has
 * earned.
 *
 * `max-w-2xl` because a form stretched across a wide monitor is a form whose
 * labels and controls have lost each other.
 */
const AppFormPage = ({
  title,
  description,
  isPending,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly isPending: boolean;
  readonly children: ReactNode;
}) => {
  useBlocker({ shouldBlockFn: () => isPending, enableBeforeUnload: false });

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        {/*
         * A real `h2`, not `CardTitle` — which is a styled `div`.
         *
         * The other two shells title themselves with Radix's `DialogTitle` and
         * `SheetTitle`, both of which are headings, so a `CardTitle` here would
         * make "the same form in three shells" false for the one consumer that
         * cannot see styling: a screen reader would find a heading in two of
         * them and a run of bold text in the third. Caught by the suite that
         * runs the same assertions against all three, which is what it is for.
         */}
        <h2 className="leading-none font-semibold">{title}</h2>
        {description === undefined ? null : (
          <CardDescription>{description}</CardDescription>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
};
