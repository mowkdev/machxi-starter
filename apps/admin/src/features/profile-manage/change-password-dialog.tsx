import { zodResolver } from "@hookform/resolvers/zod";
import {
  changePasswordBody,
  type ChangePasswordBody,
  type ErrorCode,
} from "@repo/contracts";
import { useForm } from "react-hook-form";

import { useChangePassword } from "@/entities/profile";
import { AppFormDialog } from "@/shared/form/app-form-dialog";
import { createAppFormInput } from "@/shared/form/app-form-input";
import { applyServerErrors } from "@/shared/form/server-errors";
import type { FieldConfigMap } from "@/shared/resource/types";

/**
 * `POST /admin/profile/change-password` — the operator changing their own
 * credential (ADR-0027 §Staff self-service).
 *
 * The mirror image of `ResetStaffPasswordDialog`, and the differences are the
 * ADR's rather than this form's: there both boxes were about somebody else and
 * neither could claim `autocomplete`, here **both passwords are this
 * operator's own** — so the browser is told the truth, and the "save this
 * password?" prompt that follows is the correct outcome rather than a leak of
 * a third party's credential into the acting admin's password manager.
 *
 * The field map lives in this feature and not on the profile's own config, the
 * same call `staff-manage` made (ADR-0035, amended D3.7): a credential is not
 * an attribute of the account, which is why the endpoint is a sub-resource and
 * not a field on `PATCH /profile`. `variant="action"` is what says so in the
 * vocabulary.
 */
export const changePasswordFields = {
  currentPassword: {
    label: "Current password",
    component: "input",
    // The one thing here that a password manager should offer to fill.
    props: { type: "password", autoComplete: "current-password" },
    description:
      "Required even though you are signed in — a stolen session must not be able to set a new password.",
  },
  newPassword: {
    label: "New password",
    component: "input",
    /*
     * `new-password`, and the contrast with the two reset forms is the point.
     * D3.7 refused it there because those boxes held the *subject's*
     * credential and a saved copy would have been somebody else's password
     * filed in the acting admin's vault. This box holds the credential of the
     * person typing it, so offering to save it is the browser doing its job.
     */
    props: { type: "password", autoComplete: "new-password" },
    description: "Every other session is signed out. This one stays signed in.",
  },
} as const satisfies FieldConfigMap;

const PasswordFormInput = createAppFormInput(changePasswordFields);

/**
 * `AUTH_CURRENT_PASSWORD_INVALID` is a `403` with no `details` — the condition
 * belongs to the credential check rather than to a request field (ADR-0027
 * §Contracts) — but the operator's question is "what do I retype?", and the
 * answer is the first box.
 */
const PASSWORD_ERROR_FIELDS: Readonly<Partial<Record<ErrorCode, string>>> = {
  AUTH_CURRENT_PASSWORD_INVALID: "currentPassword",
};

export const ChangePasswordDialog = ({
  onClose,
}: {
  readonly onClose: () => void;
}) => {
  const changePassword = useChangePassword();

  const form = useForm<ChangePasswordBody>({
    resolver: zodResolver(changePasswordBody),
    defaultValues: { currentPassword: "", newPassword: "" },
    disabled: changePassword.isPending,
  });

  const onSubmit = async (values: ChangePasswordBody) => {
    try {
      await changePassword.mutateAsync(values);
      // Before `onClose`, so the plaintext is gone from the form state whether
      // or not React gets around to unmounting the dialog this tick.
      form.reset();
      onClose();
    } catch (error) {
      applyServerErrors(error, form.setError, {
        fields: Object.keys(changePasswordFields),
        codeFields: PASSWORD_ERROR_FIELDS,
      });
    }
  };

  return (
    <AppFormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Change your password"
      description="Signing out your other sessions is the point of a password change, so it is not optional. Nothing forces a change again afterwards."
      form={form}
      fields={changePasswordFields}
      variant="action"
      onSubmit={onSubmit}
      isPending={changePassword.isPending}
      submitLabel="Change password"
    >
      <PasswordFormInput fieldName="currentPassword" />
      <PasswordFormInput fieldName="newPassword" />
    </AppFormDialog>
  );
};
