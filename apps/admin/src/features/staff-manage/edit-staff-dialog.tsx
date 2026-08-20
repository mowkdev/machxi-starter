import { zodResolver } from "@hookform/resolvers/zod";
import {
  updateStaffBody,
  type StaffResource,
  type UpdateStaffBody,
} from "@repo/contracts";
import { useForm } from "react-hook-form";

import {
  STAFF_ERROR_FIELDS,
  StaffFormInput,
  staffResourceConfig,
  useStaff,
  useUpdateStaff,
} from "@/entities/staff";
import { AppFormDialog } from "@/shared/form/app-form-dialog";
import { applyServerErrors } from "@/shared/form/server-errors";
import { dirtyValuesOf } from "@/shared/resource/config";

/**
 * `PATCH /admin/staff/:id` — names, roles and status (ADR-0017).
 *
 * The same field configuration as the create form, rendered under
 * `variant="edit"`: `email` and `password` disappear because the config says
 * they are create-only, and `status` appears because it says the opposite. One
 * declaration, two forms, and no way for them to disagree about what a staff
 * member is.
 *
 * The refusals this form can meet are the service's, not the schema's — an
 * `admin` granting `super_admin`, the last super admin being demoted or
 * disabled (ADR-0017 §Invariants) — and none of them is pre-guessed here. They
 * arrive as `403` / `409 STAFF_LAST_SUPER_ADMIN` and are rendered by
 * `AppFormError` through ADR-0034's map, which is the only place that decides
 * how a failure reads.
 */

/** The staff member as this form's values. `roles` is copied, not aliased. */
const toFormValues = (staff: StaffResource): UpdateStaffBody => ({
  firstName: staff.firstName,
  lastName: staff.lastName,
  roles: [...staff.roles],
  status: staff.status,
});

export const EditStaffDialog = ({
  staff,
  onClose,
}: {
  readonly staff: StaffResource;
  readonly onClose: () => void;
}) => {
  const updateStaff = useUpdateStaff();
  /*
   * `GET /admin/staff/:id`, even though the grid handed us the row.
   *
   * The row is a page that may have been fetched minutes ago, and this is the
   * screen where being one edit behind costs the most: a stale `roles` array
   * re-submitted whole would silently undo somebody else's change. The row is
   * still the *seed*, so the form is filled the instant it opens rather than
   * after a round trip — the detail query only corrects it.
   */
  const detail = useStaff(staff.id);

  const form = useForm<UpdateStaffBody>({
    resolver: zodResolver(updateStaffBody),
    defaultValues: toFormValues(staff),
    /*
     * `values` + `keepDirtyValues` is RHF's own answer to "the server told us
     * something newer while the operator was typing": untouched fields take the
     * fresh value, touched ones are left alone. Without `keepDirtyValues` the
     * arriving detail would wipe whatever had been typed in the meantime.
     */
    values: toFormValues(detail.data ?? staff),
    resetOptions: { keepDirtyValues: true },
    disabled: updateStaff.isPending,
  });

  const onSubmit = async (values: UpdateStaffBody) => {
    /*
     * Pruned to what the operator actually changed (ADR-0035), which is what
     * makes the contract's "provide at least one field" refinement measure a
     * real edit — and what stops a re-send of every seeded value overwriting a
     * field a second admin changed in the meantime.
     */
    const body = dirtyValuesOf(values, form.formState.dirtyFields);

    // Unreachable through the disabled button, kept because implicit submission
    // from a text field is not consistently blocked by it — and an empty body
    // is a `VALIDATION_ERROR` the operator did nothing to earn.
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }

    try {
      await updateStaff.mutateAsync({ id: staff.id, body });
      onClose();
    } catch (error) {
      applyServerErrors(error, form.setError, {
        fields: Object.keys(staffResourceConfig.fields),
        codeFields: STAFF_ERROR_FIELDS,
      });
    }
  };

  return (
    <AppFormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={`Edit ${staff.email}`}
      description="Email is not editable — changing the identifier a session was established with is its own flow."
      form={form}
      fields={staffResourceConfig.fields}
      variant="edit"
      onSubmit={onSubmit}
      isPending={updateStaff.isPending}
      submitLabel="Save changes"
      // Nothing changed is nothing to send, and saying so on the button is
      // kinder than a validation error that says the same thing afterwards.
      canSubmit={form.formState.isDirty}
    >
      <StaffFormInput fieldName="email" />
      <div className="grid gap-4 sm:grid-cols-2">
        <StaffFormInput fieldName="firstName" />
        <StaffFormInput fieldName="lastName" />
      </div>
      <StaffFormInput fieldName="status" />
      <StaffFormInput fieldName="roles" />
    </AppFormDialog>
  );
};
