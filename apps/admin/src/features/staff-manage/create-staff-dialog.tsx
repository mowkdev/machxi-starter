import { zodResolver } from "@hookform/resolvers/zod";
import { createStaffBody, type CreateStaffBody } from "@repo/contracts";
import { useForm } from "react-hook-form";

import {
  STAFF_ERROR_FIELDS,
  StaffFormInput,
  staffResourceConfig,
  useCreateStaff,
} from "@/entities/staff";
import { AppFormDialog } from "@/shared/form/app-form-dialog";
import { applyServerErrors } from "@/shared/form/server-errors";
import { initialValuesFor } from "@/shared/resource/config";

/**
 * `POST /admin/staff` — an admin creates an operator with an initial password
 * (ADR-0018 §Staff onboarding).
 *
 * The whole form is the resource's config: which fields exist, what they are
 * labelled, which control each one is and what it starts as were all declared
 * once in `entities/staff`. What this file contributes is *where* they go and
 * what happens on submit — the line ADR-0035 draws and the reason config never
 * grows a `layout` key.
 *
 * Validation is `createStaffBody`, the object the API validates with
 * (ADR-0011/0023), so a password rule tightened in `@repo/contracts` tightens
 * this form in the same commit and there is no second copy to drift.
 */
export const CreateStaffDialog = ({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}) => {
  const createStaff = useCreateStaff();

  const form = useForm<CreateStaffBody>({
    resolver: zodResolver(createStaffBody),
    /*
     * `initialValuesFor` reads the config's `initialValue`s, so `roles` starts
     * `["editor"]` and every text field starts `""` rather than `undefined` —
     * which is what stops React taking the controls as uncontrolled on the
     * first render and warning the moment the operator types.
     */
    defaultValues: initialValuesFor(
      staffResourceConfig.fields,
      "create",
    ) as unknown as CreateStaffBody,
    // The submit lock, half one (ADR-0035): RHF disables every registered field.
    disabled: createStaff.isPending,
  });

  const onSubmit = async (values: CreateStaffBody) => {
    try {
      await createStaff.mutateAsync(values);
      form.reset();
      onClose();
    } catch (error) {
      /*
       * `STAFF_EMAIL_TAKEN` is a `409` with no `details`, so without the code
       * map it would land at the top of the form when the answer is plainly the
       * email box. Everything the server *does* give a path for — a password
       * the policy rejects, a role that is not in the enum — lands on its own
       * field, and whatever matches nothing is still shown by `AppFormError`.
       */
      applyServerErrors(error, form.setError, {
        fields: Object.keys(staffResourceConfig.fields),
        codeFields: STAFF_ERROR_FIELDS,
      });
    }
  };

  return (
    <AppFormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="New staff member"
      description="They can sign in as soon as this is saved."
      form={form}
      fields={staffResourceConfig.fields}
      variant="create"
      onSubmit={onSubmit}
      isPending={createStaff.isPending}
      submitLabel="Create"
    >
      <StaffFormInput fieldName="email" />
      <StaffFormInput fieldName="password" />
      <div className="grid gap-4 sm:grid-cols-2">
        <StaffFormInput fieldName="firstName" />
        <StaffFormInput fieldName="lastName" />
      </div>
      {/*
       * `status` is placed and does not render: it is `variants: ["edit"]` in
       * config, because `createStaffBody` takes no status — ADR-0018 creates
       * staff `active`. The config decides, not this JSX, which is what lets
       * one placement serve both forms.
       */}
      <StaffFormInput fieldName="status" />
      <StaffFormInput fieldName="roles" />
    </AppFormDialog>
  );
};
