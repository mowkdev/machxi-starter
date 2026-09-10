import type { ReactNode } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";

import { useT } from "@repo/i18n";
import type { FieldConfigMap, FieldVariant } from "@repo/resource";
import { Button } from "@repo/ui/components/button";
import { FieldSet } from "@repo/ui/components/field";
import { Spinner } from "@repo/ui/components/spinner";

import { AppFormProvider } from "./context";

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
 *
 * **`AppFormError` left this element at `D8.9`** and now renders one file up,
 * inside `FieldGroup`, in `app-form-surface.tsx` and `app-form-dialog.tsx`.
 * ADR-0035's guarantee is untouched and the reason is narrower than "same
 * module": what left is *layout*, and the D3.7 amendment names the chrome a
 * resource would otherwise repeat — the providers, the submit lock, the
 * error's single home — not the boxes that chrome sits in. Both call sites are
 * still in `shared/form`, so the failure `applyServerErrors` could not land on
 * a field still has exactly one implementation per shell rather than one per
 * resource, which is the property that amendment was protecting. The invariant
 * is checked as structure rather than as a file location: the error node is a
 * descendant of the `<form>` and of the disabled `FieldSet`, asserted in
 * `__tests__/app-form-surface.test.tsx`.
 *
 * **And it no longer takes a `footer` since `D8.11`.** The prop existed for
 * one step, to keep `app-form-dialog.tsx` compiling while the drawer and the
 * page moved to the container ahead of it; with all three shells now handing
 * their footer to `RecordSurface`, which owns where a fixed footer goes, the
 * last caller is gone and the prop with it. The rule it carried is not lost —
 * the footer is still inside the `<form>` and inside the locked `FieldSet`,
 * because it arrives as one of the container's rows, which are this
 * component's `children`.
 *
 * What it does **not** own is layout: since `D8.9` its `children` are the
 * container's three rows and the field JSX lives one file up, but the rule is
 * the same one ADR-0035 draws — "config declares *what* a field is; *where* it
 * renders is the page's JSX" — and a frame that read the field map to decide
 * what to render would be the form DSL that ADR forbids.
 */

/**
 * `TSubmitted` defaults to `TValues`, and the two differ exactly when a form's
 * **state is not its request body** (**amended D3.7 → D3.8**).
 *
 * That is not the common case and was not the case at all until `D3.8`: a body
 * whose fields are all required is held by the controls as-is. A body with
 * *optional* fields is not, because "the operator left this blank" has to
 * arrive as an absent key and no control can hold absence. Such a form
 * resolves through a transform, RHF types that with its third parameter, and
 * this frame has to carry the pair or the caller is forced into a cast that
 * asserts away the very distinction the transform exists to make.
 *
 * **`createStaffBody` was this comment's example of the all-required case and
 * stopped being one at `D18.11`**: ADR-0071 §8 made its `password` optional,
 * because leaving the box empty *is* the request to send an invitation. That
 * surface transforms on the way out like the users one — it wraps the resolver
 * rather than reaching for `TSubmitted`, which is the shape below and the one
 * a form with a `zodResolver` over the wire body should prefer.
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
  /**
   * **The container's rows, not the field JSX** (`D8.9`, ADR-0048 §4).
   *
   * Under the inversion this component is the element `RecordSurface` asks for
   * through its `column` render prop, so what it wraps is the surface's
   * header, body and footer — all three, which is what makes a `type="submit"`
   * button work in a *fixed* footer and lets that footer read form state
   * through context. The fields moved up one file into `app-form-surface.tsx`,
   * which passes them as the container's body content.
   */
  readonly children: ReactNode;
  /**
   * The container's geometry classes, forwarded to the `<form>`.
   *
   * The row template and the body's `min-h-0` have to land on this element,
   * because the modal primitives lay out their *direct* children and after the
   * wrap this form is the only one.
   */
  readonly className?: string;
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
  className,
}: AppFormFrameProps<TValues, TSubmitted>) => (
  <AppFormProvider fields={fields} variant={variant} form={form}>
    {/*
     * `noValidate`: validation is the contracts schema through `zodResolver`,
     * and the browser's own bubbles would answer a different question in a
     * different voice — and stop the submit before the schema that client and
     * server share ever ran (ADR-0035).
     */}
    <form
      className={className}
      noValidate
      onSubmit={(event) => {
        void form.handleSubmit(onSubmit)(event);
      }}
    >
      {/*
       * **`display: contents` on the lock** (`D8.9`, ADR-0048 §4). The
       * container's rows have to be the `<form>`'s own grid children — the row
       * template is on the form and a grid lays out its direct children — so
       * this element must stop laying out while still locking. `contents`
       * removes the *box*, not the element: `disabled` still propagates to
       * every control inside it, the footer's submit button included, and
       * `aria-busy` is still on a node in the accessibility tree.
       *
       * The residual is named rather than assumed: some assistive technology
       * historically dropped `display: contents` elements from that tree.
       * `D8.12`'s browser walk checks it once; if it bites, the `contents`
       * display moves to an inner wrapper and the `FieldSet` keeps its box.
       *
       * Its `flex flex-col gap-6` goes inert with the box, and that spacing
       * was the fields-to-footer distance. Each shell absorbed it as an
       * `mt-12` on the footer it handed `RecordSurface` until **`D11.5`**,
       * when that footer became a **band** — 64px on `--muted` under a top
       * rule, owned by the container — so the band's own height and its rule
       * are that distance now and both margins retired (ADR-0054 §7).
       */}
      <FieldSet aria-busy={isPending} className="contents" disabled={isPending}>
        {children}
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
}) => {
  /*
   * **`form:actions.cancel`, not `common:actions.cancel`** (`D9.5`,
   * ADR-0046 §13). The word is the same one the admin's `common` namespace
   * carries and the ownership is not: a package declares the strings it
   * renders and never reads an app's dictionary, so this button's label is
   * this package's copy. That the admin still has its own `actions.cancel` —
   * `ConfirmDialog`'s, which no form renders — is two owners of one English
   * word rather than a duplicate, and the grid took the same route at `D9.4`
   * for the three it was the only reader of.
   */
  const { t } = useT("form");

  return (
    <>
      <Button type="button" variant="outline" onClick={onCancel}>
        {t("actions.cancel")}
      </Button>
      <Button type="submit" disabled={!canSubmit}>
        {isPending ? <Spinner /> : null}
        {submitLabel}
      </Button>
    </>
  );
};
