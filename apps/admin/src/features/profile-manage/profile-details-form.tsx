import { zodResolver } from "@hookform/resolvers/zod";
import {
  updateStaffProfileBody,
  type StaffResource,
  type UpdateStaffProfileBody,
} from "@repo/contracts";
import { useForm } from "react-hook-form";

import {
  ProfileFormInput,
  profileFields,
  useUpdateProfile,
} from "@/entities/profile";
import { AppFormProvider } from "@/shared/form/context";
import { AppFormError } from "@/shared/form/form-error";
import { applyServerErrors } from "@/shared/form/server-errors";
import { dirtyValuesOf, fieldsForVariant } from "@/shared/resource/config";
import { Button, FieldGroup, FieldSet, Spinner } from "@/shared/ui";

import { useInvalidateOwnStaffRow } from "./use-invalidate-own-staff-row";

/**
 * `PATCH /admin/profile` — the operator's own names (ADR-0027).
 *
 * **An inline form rather than a dialog, and therefore the one place in the app
 * that assembles the frame by hand.** `AppFormDialog` owns the chrome every
 * *dialog* form repeats — the two providers, the `FieldSet disabled aria-busy`
 * half of the submit lock, `AppFormError`, and a dialog that cannot be
 * dismissed mid-flight — and everything on that list except the dialog itself
 * is repeated here, in about fifteen lines. That is deliberate and it is the
 * same call D3.8 made about its state-to-body converter: one occurrence is not
 * a pattern, and a `shared/form` frame extracted from a single caller is a
 * guess about the second one. **The second inline form is what should promote
 * it**, and this paragraph is the note to promote it from.
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

/** The account as this form's values. */
const toFormValues = (profile: StaffResource): UpdateStaffProfileBody => ({
  firstName: profile.firstName,
  lastName: profile.lastName,
});

export const ProfileDetailsForm = ({
  profile,
}: {
  readonly profile: StaffResource;
}) => {
  const updateProfile = useUpdateProfile();
  const invalidateOwnStaffRow = useInvalidateOwnStaffRow();

  const form = useForm<UpdateStaffProfileBody>({
    resolver: zodResolver(updateStaffProfileBody),
    defaultValues: toFormValues(profile),
    /*
     * `values` + `keepDirtyValues`, as the staff edit dialog does: a refetch
     * that lands while the operator is typing corrects the untouched fields
     * and leaves the touched ones alone. Here the refetch is this form's own
     * invalidation coming back, which is what makes the pair matter on a
     * surface that never unmounts.
     */
    values: toFormValues(profile),
    resetOptions: { keepDirtyValues: true },
    disabled: updateProfile.isPending,
  });

  const isPending = updateProfile.isPending;

  const onSubmit = async (values: UpdateStaffProfileBody) => {
    /*
     * Pruned to what actually changed, so the contract's "provide at least one
     * field" refinement measures a real edit (ADR-0035) — and so renaming
     * yourself does not re-send a name a second admin edited in the meantime.
     */
    const body = dirtyValuesOf(values, form.formState.dirtyFields);

    // Unreachable through the disabled button, kept because implicit
    // submission from a text field is not consistently blocked by it.
    if (Object.keys(body).length === 0) return;

    try {
      const updated = await updateProfile.mutateAsync(body);

      // The names on this operator's own `/admin/staff` row are the ones that
      // just changed — see the hook for why the invalidation is here and not
      // in the entity.
      invalidateOwnStaffRow();

      // Makes the just-saved values the new baseline, so the form is clean and
      // the button disables itself again. Without it `keepDirtyValues` would
      // hold these fields dirty against every later refetch.
      form.reset(toFormValues(updated));
    } catch (error) {
      applyServerErrors(error, form.setError, { fields: FIELD_NAMES });
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
              Save changes
            </Button>
          </div>
        </FieldSet>
      </form>
    </AppFormProvider>
  );
};
