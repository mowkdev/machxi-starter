import { zodResolver } from "@hookform/resolvers/zod";
import {
  updateProfileBody,
  type UpdateProfileBody,
  type UserResource,
} from "@repo/contracts";
import { useForm } from "react-hook-form";

import {
  ProfileFormInput,
  profileFields,
  useUpdateProfile,
} from "@/entities/profile";
import { AppFormProvider } from "@/shared/form/context";
import { AppFormError } from "@/shared/form/form-error";
import {
  applyServerErrors,
  schemaFieldRules,
} from "@/shared/form/server-errors";
import { useT } from "@/shared/i18n";
import { useMessageForError } from "@/shared/notifications/messages";
import { dirtyValuesOf, fieldsForVariant } from "@/shared/resource/config";
import { Button, FieldGroup, FieldSet, Spinner } from "@/shared/ui";

/**
 * `PATCH /user/profile` — a customer's own names (ADR-0027, ADR-0055 §4).
 *
 * **An inline form rather than a dialog, and therefore the one place in this
 * app that assembles the frame by hand.** `AppFormDialog` owns the chrome every
 * *dialog* form repeats — the two providers, the `FieldSet disabled aria-busy`
 * half of the submit lock, `AppFormError`, and a dialog that cannot be
 * dismissed mid-flight — and everything on that list except the dialog itself
 * is repeated here, in about fifteen lines.
 *
 * The admin's copy of this file carries a note saying "the second inline form
 * is what should promote it". **This is not that second form**, and the
 * distinction matters: this is the *same* form on the other segment, which is a
 * duplication of the kind this deliverable logs as a finding rather than a
 * second caller inside one app arguing for a `shared/form` frame. What would
 * promote the frame is still an inline form beside a different endpoint.
 *
 * What is *not* hand-rolled is anything that decides what a field is: the
 * fields come from `profileFields`, the controls from the registry, the
 * validation from the contract schema. This form knows only where they go,
 * which is exactly the line ADR-0035 draws.
 */

/** What this form renders — the config decides, not this file. */
const FIELD_NAMES = fieldsForVariant(profileFields, "edit").map(
  ([name]) => name,
);

/**
 * The account as this form's values.
 *
 * `?? ""` because a customer's names are nullable (ADR-0017) and a controlled
 * text input handed `null` is an uncontrolled one React warns about. What that
 * conversion cannot do is survive a round trip — an untouched empty box is
 * never dirty, so it is never submitted, so a `null` name stays `null` rather
 * than being sent back as `""` and refused.
 */
const toFormValues = (profile: UserResource): UpdateProfileBody => ({
  firstName: profile.firstName ?? "",
  lastName: profile.lastName ?? "",
});

export const ProfileDetailsForm = ({
  profile,
}: {
  readonly profile: UserResource;
}) => {
  const { t } = useT("profile");
  const updateProfile = useUpdateProfile();
  const messageForError = useMessageForError();

  const form = useForm<UpdateProfileBody>({
    resolver: zodResolver(updateProfileBody),
    defaultValues: toFormValues(profile),
    /*
     * `values` + `keepDirtyValues`: a refetch that lands while the customer is
     * typing corrects the untouched fields and leaves the touched ones alone.
     * Here the refetch is this form's own invalidation coming back, which is
     * what makes the pair matter on a surface that never unmounts.
     */
    values: toFormValues(profile),
    resetOptions: { keepDirtyValues: true },
    disabled: updateProfile.isPending,
  });

  const isPending = updateProfile.isPending;

  const onSubmit = async (values: UpdateProfileBody) => {
    /*
     * Pruned to what actually changed, so the contract's "provide at least one
     * field" refinement measures a real edit (ADR-0035) — and so correcting a
     * first name does not re-send a surname that has not moved.
     */
    const body = dirtyValuesOf(values, form.formState.dirtyFields);

    // Unreachable through the disabled button, kept because implicit
    // submission from a text field is not consistently blocked by it.
    if (Object.keys(body).length === 0) return;

    try {
      const updated = await updateProfile.mutateAsync(body);

      // Makes the just-saved values the new baseline, so the form is clean and
      // the button disables itself again. Without it `keepDirtyValues` would
      // hold these fields dirty against every later refetch.
      form.reset(toFormValues(updated));
    } catch (error) {
      applyServerErrors(error, form.setError, {
        fields: FIELD_NAMES,
        messageForError,
        /*
         * The same schema, caught a second time and in this customer's
         * language (ADR-0046 §6). A detail whose path this form renders is
         * answered by the schema the form validates with rather than echoed
         * from the wire, because the wire's English is the API's and not
         * necessarily the person's.
         */
        rules: schemaFieldRules(updateProfileBody, form.getValues()),
      });
    }
  };

  return (
    <AppFormProvider fields={profileFields} variant="edit" form={form}>
      {/* `noValidate`: the contracts schema through `zodResolver` is the
          validation, and the browser's own bubbles would answer a different
          question in a different voice (ADR-0035). */}
      <form
        noValidate
        onSubmit={(event) => {
          void form.handleSubmit(onSubmit)(event);
        }}
      >
        <FieldSet disabled={isPending} aria-busy={isPending}>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <ProfileFormInput fieldName="firstName" />
              <ProfileFormInput fieldName="lastName" />
            </div>
            <AppFormError />
          </FieldGroup>

          <div className="mt-6 flex justify-end">
            <Button type="submit" disabled={!form.formState.isDirty}>
              {isPending ? <Spinner /> : null}
              {t("save")}
            </Button>
          </div>
        </FieldSet>
      </form>
    </AppFormProvider>
  );
};
