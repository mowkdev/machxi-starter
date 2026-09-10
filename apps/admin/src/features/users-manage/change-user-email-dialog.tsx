import { zodResolver } from "@hookform/resolvers/zod";
import {
  setEmailBody,
  type ErrorCode,
  type SetEmailBody,
  type UserResource,
} from "@repo/contracts";
import { useForm } from "react-hook-form";

import { useSetUserEmail } from "@/entities/user";
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
 * `POST /admin/users/:id/email` — a super admin setting a customer's address
 * (`D18.10`, ADR-0071 §7).
 *
 * **The reset dialog's shape with one box changed**, and the change is the
 * whole difference between the two ceremonies: there the operator types a
 * credential the customer will use, here they type an identity the customer
 * will be reached at. The second box is the same in both — the acting
 * operator's own password, which ADR-0027 rule 1 asks for wherever one account
 * rewrites another's, and which matters more here than there, because an
 * address redirects every future recovery link.
 *
 * **Nothing is mailed and nothing is confirmed**, which is what parts this from
 * the customer app's own change-address dialog (ADR-0071 §6): a customer has
 * typed a mailbox they may not own, and a super admin *is* the authority the
 * confirmation link would be asking. The copy has to say so, because "we sent
 * a link" and "it is done" are opposite promises and the two dialogs look
 * alike.
 *
 * The field map lives in this feature and not on the resource config
 * (ADR-0035): `email` is a field of the *create* form, and this is not an edit
 * of that field — it is a sub-resource with a guard of its own.
 * `variant="action"` is what says so in the vocabulary.
 */
const emailFields = {
  email: {
    label: "users:changeEmail.fields.email.label",
    component: "input",
    // `type="email"` for the keyboard and the browser's own hint;
    // `autoComplete="off"` because this address belongs to the customer, and a
    // browser filing it as the operator's would offer it back on every form.
    props: { type: "email", autoComplete: "off" },
    description: "users:changeEmail.fields.email.description",
  },
  currentPassword: {
    label: "users:changeEmail.fields.currentPassword.label",
    component: "input",
    // The one field here that really is this operator's own credential.
    props: { type: "password", autoComplete: "current-password" },
    description: "users:changeEmail.fields.currentPassword.description",
  },
} as const satisfies FieldConfigMap<SetEmailBody>;

const EmailFormInput = createAppFormInput(emailFields);

/**
 * The two codes this form can put under a field, and which field each answers.
 *
 * Both are statuses with no `details` path — `AUTH_CURRENT_PASSWORD_INVALID` is
 * a property of the credential check (ADR-0027 §Contracts) and
 * `USER_EMAIL_TAKEN` a `409` about the resource — and both have an obvious box
 * the operator can act on. `USER_DELETED` is deliberately absent: nothing about
 * a soft-deleted account is fixed by retyping either field, so it belongs in
 * the form's error region as the catalogue's own sentence.
 */
const EMAIL_ERROR_FIELDS: Readonly<Partial<Record<ErrorCode, string>>> = {
  AUTH_CURRENT_PASSWORD_INVALID: "currentPassword",
  USER_EMAIL_TAKEN: "email",
};

export const ChangeUserEmailDialog = ({
  user,
  onClose,
}: {
  readonly user: UserResource;
  readonly onClose: () => void;
}) => {
  const { t } = useT("users");
  const setEmail = useSetUserEmail();
  const messageForError = useMessageForError();

  const form = useForm<SetEmailBody>({
    resolver: zodResolver(setEmailBody),
    // Empty rather than seeded with the current address: the API refuses the
    // address the account already holds, so pre-filling it would hand the
    // operator a form whose only default answer is a `409`.
    defaultValues: { email: "", currentPassword: "" },
    disabled: setEmail.isPending,
  });

  const onSubmit = async (values: SetEmailBody) => {
    try {
      await setEmail.mutateAsync({ id: user.id, body: values });
      // Before `onClose`, so the plaintext password leaves the form state
      // whether or not React unmounts this dialog on the same tick.
      form.reset();
      onClose();
    } catch (error) {
      applyServerErrors(error, form.setError, {
        fields: Object.keys(emailFields),
        codeFields: EMAIL_ERROR_FIELDS,
        messageForError,
        /*
         * The same schema, caught a second time and in this operator's
         * language (`D7.5`, ADR-0046 §6) — the address format above all, which
         * the API answers as a `details` path in its own English.
         */
        rules: schemaFieldRules(setEmailBody, form.getValues()),
      });
    }
  };

  return (
    <AppFormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("changeEmail.title", { email: user.email })}
      description={t("changeEmail.description")}
      form={form}
      fields={emailFields}
      // Neither a create nor an edit of a user — see `FieldVariant`.
      variant="action"
      onSubmit={onSubmit}
      isPending={setEmail.isPending}
      submitLabel={t("changeEmail.submit")}
    >
      <EmailFormInput fieldName="email" />
      <EmailFormInput fieldName="currentPassword" />
    </AppFormDialog>
  );
};

export { emailFields as changeUserEmailFields };
