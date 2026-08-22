import { zodResolver } from "@hookform/resolvers/zod";
import {
  setPasswordBody,
  type ErrorCode,
  type SetPasswordBody,
  type UserResource,
} from "@repo/contracts";
import { useForm } from "react-hook-form";

import { useSetUserPassword } from "@/entities/user";
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
 * `POST /admin/users/:id/password` — the administrative reset (ADR-0027).
 *
 * The two boxes belong to two different people: the **new** password is the
 * customer's, and the **current** one is the acting admin's own, re-presented
 * as ADR-0027 rule 1 requires. `admin` only — a manager may read the customer
 * base and may not rewrite a credential in it.
 *
 * **The field map is declared here and not shared with the staff reset**, even
 * though `setPasswordBody` is one schema for both populations and the copy
 * currently happens to be word-for-word identical. A field map is *content*,
 * not machinery: it is the labels and descriptions of one screen, and
 * `shared/form` holds the registry, the adapters, the provider and the dialog
 * frame — the moment it started holding a form's copy it would stop being any
 * of those. Two field maps that look alike is the same non-problem as two
 * configs that both declare an `email` field (ADR-0035, amended D3.7); what
 * would be a problem is a shared one, the day an operator's reset and a
 * customer's need to say different things and only one of them can.
 */
const passwordFields = {
  password: {
    label: "users:resetPassword.fields.password.label",
    component: "input",
    // `off`, never `new-password`: this box holds the customer's credential,
    // not the operator's, and a browser reading it as theirs would offer to
    // save somebody else's password into their password manager.
    props: { type: "password", autoComplete: "off" },
    description: "users:resetPassword.fields.password.description",
  },
  currentPassword: {
    label: "users:resetPassword.fields.currentPassword.label",
    component: "input",
    // The one field here that really is this operator's own credential.
    props: { type: "password", autoComplete: "current-password" },
    description: "users:resetPassword.fields.currentPassword.description",
  },
} as const satisfies FieldConfigMap;

const PasswordFormInput = createAppFormInput(passwordFields);

/**
 * `AUTH_CURRENT_PASSWORD_INVALID` is a `403` with no field path — it is a
 * property of the credential check (ADR-0027 §Contracts) — but the operator's
 * question is still "what do I retype?", and the answer is the second box.
 */
const PASSWORD_ERROR_FIELDS: Readonly<Partial<Record<ErrorCode, string>>> = {
  AUTH_CURRENT_PASSWORD_INVALID: "currentPassword",
};

export const ResetUserPasswordDialog = ({
  user,
  onClose,
}: {
  readonly user: UserResource;
  readonly onClose: () => void;
}) => {
  const { t } = useT("users");
  const setPassword = useSetUserPassword();
  const messageForError = useMessageForError();

  const form = useForm<SetPasswordBody>({
    resolver: zodResolver(setPasswordBody),
    defaultValues: { password: "", currentPassword: "" },
    disabled: setPassword.isPending,
  });

  const onSubmit = async (values: SetPasswordBody) => {
    try {
      await setPassword.mutateAsync({ id: user.id, body: values });
      form.reset();
      onClose();
    } catch (error) {
      applyServerErrors(error, form.setError, {
        fields: Object.keys(passwordFields),
        codeFields: PASSWORD_ERROR_FIELDS,
        messageForError,
        /*
         * The same schema, caught a second time and in this operator's
         * language (`D7.5`, ADR-0046 §6). A detail whose path this form
         * renders is answered by the schema the form validates with rather
         * than echoed from the wire, because the wire's English is the API's
         * and not necessarily the operator's.
         */
        rules: schemaFieldRules(setPasswordBody, form.getValues()),
      });
    }
  };

  return (
    <AppFormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("resetPassword.title", { email: user.email })}
      description={t("resetPassword.description")}
      form={form}
      fields={passwordFields}
      // Neither a create nor an edit of a user — see `FieldVariant`.
      variant="action"
      onSubmit={onSubmit}
      isPending={setPassword.isPending}
      submitLabel={t("resetPassword.submit")}
    >
      <PasswordFormInput fieldName="password" />
      <PasswordFormInput fieldName="currentPassword" />
    </AppFormDialog>
  );
};

export { passwordFields };
