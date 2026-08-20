import { zodResolver } from "@hookform/resolvers/zod";
import {
  setPasswordBody,
  type ErrorCode,
  type SetPasswordBody,
  type StaffResource,
} from "@repo/contracts";
import { useForm } from "react-hook-form";

import { useSetStaffPassword } from "@/entities/staff";
import { AppFormDialog } from "@/shared/form/app-form-dialog";
import { createAppFormInput } from "@/shared/form/app-form-input";
import { applyServerErrors } from "@/shared/form/server-errors";
import type { FieldConfigMap } from "@/shared/resource/types";

/**
 * `POST /admin/staff/:id/password` — the administrative reset (ADR-0027).
 *
 * The two boxes belong to two different people, which is the whole design and
 * the thing the labels have to make obvious: the **new** password is the
 * subject's, and the **current** one is the acting admin's own, re-presented.
 * ADR-0027 rule 1 calls that the cheapest step-up available in a repository
 * with no re-authentication category, and what it buys is that fifteen minutes
 * of a stolen admin token is not an account-takeover engine.
 *
 * **The field map lives here rather than on the resource**, and that is the
 * rule rather than an exception to it (ADR-0035, amended D3.7):
 * `staffResourceConfig.fields` describes what a staff member *is*, and neither
 * of these is an attribute of one — the endpoint is a sub-resource for exactly
 * that reason (ADR-0027 §Administrative reset). `AppFormProvider` is keyed on a
 * `FieldConfigMap`, not on a `ResourceConfig`, so an action form declares its
 * own and gets the same registry, the same adapters and the same submit lock.
 * What it owes in return is the same contract test a resource config owes, and
 * `__tests__/staff-manage.test.tsx` carries it.
 */
export const passwordFields = {
  password: {
    label: "New password",
    component: "input",
    /*
     * `off`, not `new-password`. This box holds the *subject's* credential, and
     * a `new-password` field sitting next to a `current-password` one is the
     * exact shape a browser reads as "this person is changing their own
     * password" — answered with a "Save password?" prompt that would file
     * somebody else's credential into the acting admin's password manager and
     * sync it off the machine. `off` is a hint browsers may ignore, so this
     * narrows the case rather than closing it; the D3.7 step notes record the
     * residual and what would close it.
     */
    props: { type: "password", autoComplete: "off" },
    description:
      "Hand it over out of band. Every session of this account is signed out.",
  },
  currentPassword: {
    label: "Your own current password",
    component: "input",
    // The one field here that really is this operator's own credential, and
    // therefore the only one that may say so to the browser.
    props: { type: "password", autoComplete: "current-password" },
    description: "Confirms it is you making the change, not a stolen session.",
  },
} as const satisfies FieldConfigMap;

const PasswordFormInput = createAppFormInput(passwordFields);

/**
 * `AUTH_CURRENT_PASSWORD_INVALID` is a `403` with no `details` — it is a
 * property of the credential check rather than of a request field (ADR-0027
 * §Contracts) — but the operator's question is still "what do I retype?", and
 * the answer is the second box, not the first.
 */
const PASSWORD_ERROR_FIELDS: Readonly<Partial<Record<ErrorCode, string>>> = {
  AUTH_CURRENT_PASSWORD_INVALID: "currentPassword",
};

export const ResetStaffPasswordDialog = ({
  staff,
  onClose,
}: {
  readonly staff: StaffResource;
  readonly onClose: () => void;
}) => {
  const setPassword = useSetStaffPassword();

  const form = useForm<SetPasswordBody>({
    resolver: zodResolver(setPasswordBody),
    defaultValues: { password: "", currentPassword: "" },
    disabled: setPassword.isPending,
  });

  const onSubmit = async (values: SetPasswordBody) => {
    try {
      await setPassword.mutateAsync({ id: staff.id, body: values });
      form.reset();
      onClose();
    } catch (error) {
      applyServerErrors(error, form.setError, {
        fields: Object.keys(passwordFields),
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
      title={`Reset the password for ${staff.email}`}
      description="They stay signed out until they use the new password. Nothing forces them to change it afterwards."
      form={form}
      fields={passwordFields}
      // Neither a create nor an edit of a staff member — see `FieldVariant`.
      variant="action"
      onSubmit={onSubmit}
      isPending={setPassword.isPending}
      submitLabel="Reset password"
    >
      <PasswordFormInput fieldName="password" />
      <PasswordFormInput fieldName="currentPassword" />
    </AppFormDialog>
  );
};
