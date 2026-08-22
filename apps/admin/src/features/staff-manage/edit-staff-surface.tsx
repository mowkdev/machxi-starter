import { zodResolver } from "@hookform/resolvers/zod";
import {
  updateStaffBody,
  type StaffResource,
  type UpdateStaffBody,
} from "@repo/contracts";
import { useNavigate } from "@tanstack/react-router";

import { useRecordNavigation } from "@/shared/grid/record-navigation";
import { useForm } from "react-hook-form";

import {
  StaffFormInput,
  staffResourceConfig,
  useStaff,
  useUpdateStaff,
} from "@/entities/staff";
import { AppFormSurface } from "@/shared/form/app-form-surface";
import { useT } from "@/shared/i18n";
import { applyServerErrors } from "@/shared/form/server-errors";
import { useMessageForError } from "@/shared/notifications/messages";
import {
  dirtyValuesOf,
  editSurfaceOf,
  fieldsForVariant,
} from "@/shared/resource/config";

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
 *
 * **The record arrives from the route loader, not from the row that was
 * clicked** (`D4.2`, ADR-0040). That is the substantive change the URL bought:
 * `/staff/$staffId` is reachable by reload, by Back, and by a link from
 * somebody else's chat window, and in none of those cases is there a grid row
 * to hand over. The loader's `ensureQueryData` has already primed
 * `staffKeys.detail(id)`, so `useStaff` below reads a warm cache rather than
 * fetching again — the seed is as immediate as the row used to be, and it is
 * the record rather than a copy of it that may be minutes old.
 */

/** What the edit form puts on screen — the config decides, not this file. */
const FIELD_NAMES = fieldsForVariant(staffResourceConfig.fields, "edit").map(
  ([name]) => name,
);

/** The staff member as this form's values. `roles` is copied, not aliased. */
const toFormValues = (staff: StaffResource): UpdateStaffBody => ({
  firstName: staff.firstName,
  lastName: staff.lastName,
  roles: [...staff.roles],
  status: staff.status,
});

export const EditStaffSurface = ({
  staff,
}: {
  /** The record the route loaded. */
  readonly staff: StaffResource;
}) => {
  const { t } = useT("staff");
  const navigate = useNavigate();
  const { closeSearch } = useRecordNavigation();
  const updateStaff = useUpdateStaff();
  const messageForError = useMessageForError();

  /*
   * The way back is history state, not the URL (ADR-0044, `D5.3`): this record
   * carries no list params, so the view the operator left comes from the
   * navigation that opened it. A record reached by a link from somebody else
   * carries none, and closes to the bare list — which is honest, because the
   * recipient never had the sender's view.
   */
  const close = () => {
    void navigate({ to: "/staff", search: closeSearch });
  };
  /*
   * The same key the loader primed, so this resolves from cache on the first
   * render and refetches only when ADR-0034's `staleTime` says it is worth it.
   *
   * It stays a `useQuery` rather than reading the loader's value once, because
   * this is the screen where being one edit behind costs the most: a stale
   * `roles` array re-submitted whole would silently undo somebody else's
   * change, and a subscription is what notices when the cache is invalidated
   * under it.
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
      close();
      return;
    }

    try {
      await updateStaff.mutateAsync({ id: staff.id, body });
      close();
    } catch (error) {
      /*
       * This variant's names — see the note in `create-staff-surface.tsx`. Here
       * it is what makes `STAFF_EMAIL_TAKEN` behave: the edit form renders no
       * `email`, so the code has no field to claim and the message lands at the
       * top of the form where it can actually be read.
       */
      applyServerErrors(error, form.setError, {
        fields: FIELD_NAMES,
        codeFields: staffResourceConfig.errorFields,
        messageForError,
      });
    }
  };

  return (
    <AppFormSurface
      surface={editSurfaceOf(staffResourceConfig)}
      onClose={close}
      title={t("edit.title", { email: staff.email })}
      description={t("edit.description")}
      form={form}
      fields={staffResourceConfig.fields}
      variant="edit"
      onSubmit={onSubmit}
      isPending={updateStaff.isPending}
      submitLabel={t("edit.submit")}
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
    </AppFormSurface>
  );
};
