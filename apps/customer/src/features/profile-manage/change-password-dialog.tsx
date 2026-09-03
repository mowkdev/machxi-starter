import { zodResolver } from "@hookform/resolvers/zod";
import {
  changePasswordBody,
  type ChangePasswordBody,
  type ErrorCode,
} from "@repo/contracts";
import { useForm } from "react-hook-form";

import { useChangePassword } from "@/entities/profile";
import { useSession } from "@/shared/api/context";
import { AppFormDialog } from "@/shared/form/app-form-dialog";
import { createAppFormInput } from "@/shared/form/app-form-input";
import {
  applyServerErrors,
  schemaFieldRules,
} from "@/shared/form/server-errors";
import { useT } from "@/shared/i18n";
import { useMessageForError } from "@/shared/notifications/messages";
import type { FieldConfigMap } from "@/shared/resource/types";

/**
 * `POST /user/profile/change-password` — a customer changing their own
 * credential (ADR-0027 §Self-service, ADR-0055 §4).
 *
 * A dialog rather than a section of the page, and the reason is ADR-0040's
 * rather than this form's: a password change is a **ceremony** — it has no
 * state worth returning to and must not be deep-linkable, so it is one of the
 * two things ADR-0035's modal shell still holds after the record forms became
 * routes.
 *
 * The field map lives in this feature and not on the profile's own config
 * (ADR-0035): a credential is not an attribute of the account, which is why the
 * endpoint is a sub-resource and not a field on `PATCH /profile`.
 * `variant="action"` is what says so in the vocabulary.
 *
 * **Both passwords are this customer's own**, so the browser is told the truth
 * through `autoComplete` and the "save this password?" prompt that follows is
 * the correct outcome. The admin's two administrative reset forms refuse those
 * hints because their boxes hold a *third party's* credential; nothing on this
 * segment can be about anybody but the caller, so the question never arises
 * here.
 */
export const changePasswordFields = {
  currentPassword: {
    label: "profile:password.fields.currentPassword.label",
    component: "input",
    props: { type: "password", autoComplete: "current-password" },
    description: "profile:password.fields.currentPassword.description",
  },
  newPassword: {
    label: "profile:password.fields.newPassword.label",
    component: "input",
    props: { type: "password", autoComplete: "new-password" },
    description: "profile:password.fields.newPassword.description",
  },
} as const satisfies FieldConfigMap<ChangePasswordBody>;

const PasswordFormInput = createAppFormInput(changePasswordFields);

/**
 * `AUTH_CURRENT_PASSWORD_INVALID` is a `403` with no `details` — the condition
 * belongs to the credential check rather than to a request field (ADR-0027
 * §Contracts) — but the customer's question is "what do I retype?", and the
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
  const { t } = useT("profile");
  const changePassword = useChangePassword();
  const messageForError = useMessageForError();
  const { principal } = useSession();

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
        messageForError,
        /*
         * The same schema, caught a second time and in this customer's
         * language (ADR-0046 §6). `passwordMustDiffer` is the refinement this
         * matters most for: the API answers it as a `details` path, and the
         * sentence a person reads for it is the catalogue's rather than the
         * wire's English.
         */
        rules: schemaFieldRules(changePasswordBody, form.getValues()),
      });
    }
  };

  return (
    <AppFormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("password.dialog.title")}
      description={t("password.dialog.description")}
      form={form}
      fields={changePasswordFields}
      variant="action"
      onSubmit={onSubmit}
      isPending={changePassword.isPending}
      submitLabel={t("password.dialog.submit")}
    >
      {/*
       * The identity anchor a password manager needs. Two password boxes and no
       * username gives it nothing to key the update on, so it either updates
       * the wrong saved entry or files a duplicate — and either leaves a vault
       * entry that no longer opens the account. `login-form` already does this
       * with a real field; here the value is not the customer's to edit, so it
       * is present and hidden rather than shown. `hidden` is a hint a browser
       * may ignore, like the `autoComplete` values themselves.
       */}
      <input
        aria-hidden
        autoComplete="username"
        hidden
        readOnly
        tabIndex={-1}
        value={principal?.email ?? ""}
      />
      <PasswordFormInput fieldName="currentPassword" />
      <PasswordFormInput fieldName="newPassword" />
    </AppFormDialog>
  );
};
