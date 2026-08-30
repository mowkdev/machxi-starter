import { useBlocker } from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";

import type {
  EditSurfaceKey,
  FieldConfigMap,
  FieldVariant,
} from "@repo/resource";
import { FieldGroup } from "@repo/ui/components/field";
import {
  RecordSurface,
  type RecordSurfaceColumnProps,
} from "@repo/ui/compositions/record-surface";

import { AppFormDialog } from "./app-form-dialog";
import { AppFormActions, AppFormFrame } from "./app-form-frame";
import { AppFormError } from "./form-error";

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
/*
 * **The `mt-12` retires at `D11.5`** (ADR-0054 §7), and the reason it existed
 * is the reason it goes. It was the fields-to-footer distance: `FieldSet` is
 * `flex flex-col gap-6`, `display: contents` removed its box, that `gap-6`
 * went inert, and this margin absorbed it plus the shipped `mt-6`. The footer
 * is now a **band** — 64px on `--muted` under a top rule, owned by
 * `RecordSurface` — so the distance is the band's height and its rule, and a
 * 3rem margin inside it would push the actions out of the band it lives in.
 *
 * `w-full` so the row still spans: the band is `flex items-center` and would
 * otherwise size this element to its content, which on a phone would stop the
 * dialog's `flex-col-reverse` stack from filling the width it fills today.
 */
const FOOTER = "flex w-full justify-end gap-2";

/**
 * §7's 20px field stack, over `FieldGroup`'s own `gap-7` (28px).
 *
 * Written where the group is rendered rather than in the primitive, which
 * ADR-0047 keeps byte-identical — and rendered here rather than in
 * `RecordSurface` because the fields are the *app's* body content and the
 * container is content-agnostic.
 */
const FIELD_STACK = "gap-5";

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
     * is exactly the drift ADR-0035 built one frame to prevent. Since `D8.11`
     * that shell is on `RecordSurface` too, so all three variants now come out
     * of the same container and the delegation is one hop rather than a second
     * implementation. `open` is always `true` — the route match is what opens
     * it — and every dismissal resolves to the same navigation.
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

  /*
   * The inversion (ADR-0048 §4). `RecordSurface` owns the geometry and asks
   * for the element that carries it; `AppFormFrame` supplies its `<form>`,
   * which therefore wraps header, body and footer — so a `type="submit"`
   * button in a *fixed* footer works, and that footer reads form state through
   * the same context the fields do.
   *
   * The fields are the container's **body**, not the frame's children: the
   * frame's children are now the three rows. `FieldGroup` and `AppFormError`
   * came up one file with them, still nested the shipped way, so the body row
   * is a single child needing no wrapper and no gap of its own.
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

  const body = (
    <FieldGroup className={FIELD_STACK}>
      {children}
      <AppFormError />
    </FieldGroup>
  );

  if (surface === "drawer") {
    return (
      <RecordSurface
        column={column}
        dismissible={!isPending}
        footer={<div className={FOOTER}>{actions}</div>}
        onOpenChange={(next) => {
          // The dialog's rule, carried to the drawer (ADR-0040): a form that
          // locks its fields and then lets the operator close the window has
          // not locked anything. `dismissible` above is what refuses Escape
          // and the overlay; this only ever runs when it did not.
          if (!next) onClose();
        }}
        title={title}
        variant="drawer"
        {...(description === undefined ? {} : { description })}
      >
        {body}
      </RecordSurface>
    );
  }

  return (
    <AppFormPage
      column={column}
      footer={<div className={FOOTER}>{actions}</div>}
      isPending={isPending}
      title={title}
      {...(description === undefined ? {} : { description })}
    >
      {body}
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
 * **It renders no heading of its own since `D8.9`** (ADR-0048 §2). The page
 * variant is the one shell with no modal over it, so the shell's `<h1>` is
 * already on screen and carries the record's own label — and the two strings
 * are the same one on a create route (`staff:create.routeTitle` and
 * `create.title` are both "New staff member"), so a heading here would be two
 * visible headings with one accessible name the moment a resource declares
 * `editSurface: "page"`. The dialog and the drawer keep theirs, because Radix
 * requires them for the accessible name and `aria-hidden` keeps the shell's
 * out of reach behind them.
 *
 * The width is `RecordSurface`'s `md` token, which maps to the `max-w-2xl`
 * this component used to hardcode — because a form stretched across a wide
 * monitor is a form whose labels and controls have lost each other.
 */
const AppFormPage = ({
  title,
  description,
  isPending,
  column,
  footer,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly isPending: boolean;
  readonly column: (props: RecordSurfaceColumnProps) => ReactElement;
  readonly footer: ReactNode;
  readonly children: ReactNode;
}) => {
  useBlocker({ shouldBlockFn: () => isPending, enableBeforeUnload: false });

  return (
    <RecordSurface
      column={column}
      footer={footer}
      title={title}
      variant="page"
      {...(description === undefined ? {} : { description })}
    >
      {children}
    </RecordSurface>
  );
};
