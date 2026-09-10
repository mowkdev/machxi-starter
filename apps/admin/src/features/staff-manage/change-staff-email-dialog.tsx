import { zodResolver } from "@hookform/resolvers/zod";
import {
  setEmailBody,
  type ErrorCode,
  type SetEmailBody,
  type StaffResource,
} from "@repo/contracts";
import { useForm } from "react-hook-form";

import { useSetStaffEmail } from "@/entities/staff";
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
 * `POST /admin/staff/:id/email` — a super admin setting an operator's address
 * (`D18.10`, ADR-0071 §7).
 *
 * The users dialog's twin. **The field map is declared here and not shared with
 * it**, though `setEmailBody` is one schema for both populations and the copy
 * is currently near-identical: a field map is *content* — the labels and
 * descriptions of one screen — and `shared/form` holds the registry, the
 * adapters and the frame. The reset dialogs made the same call for the same
 * reason (ADR-0035, amended D3.7), and the two screens already differ in one
 * sentence: an operator whose address moves keeps their sessions, and a
 * customer's does too, but only one of them is reading this dialog's subject
 * over their shoulder.
 */
const emailFields = {
  email: {
    label: "staff:changeEmail.fields.email.label",
    component: "input",
    // `autoComplete="off"`: this address belongs to the subject, not to the
    // operator typing it, and a browser filing it as theirs would offer it
    // back on every form they meet.
    props: { type: "email", autoComplete: "off" },
    description: "staff:changeEmail.fields.email.description",
  },
  currentPassword: {
    label: "staff:changeEmail.fields.currentPassword.label",
    component: "input",
    props: { type: "password", autoComplete: "current-password" },
    description: "staff:changeEmail.fields.currentPassword.description",
  },
} as const satisfies FieldConfigMap<SetEmailBody>;

const EmailFormInput = createAppFormInput(emailFields);

/** The two codes with a box the operator can act on; the users twin says why. */
const EMAIL_ERROR_FIELDS: Readonly<Partial<Record<ErrorCode, string>>> = {
  AUTH_CURRENT_PASSWORD_INVALID: "currentPassword",
  STAFF_EMAIL_TAKEN: "email",
};

export const ChangeStaffEmailDialog = ({
  staff,
  onClose,
}: {
  readonly staff: StaffResource;
  readonly onClose: () => void;
}) => {
  const { t } = useT("staff");
  const setEmail = useSetStaffEmail();
  const messageForError = useMessageForError();

  const form = useForm<SetEmailBody>({
    resolver: zodResolver(setEmailBody),
    // Empty rather than seeded with the current address, which the API refuses.
    defaultValues: { email: "", currentPassword: "" },
    disabled: setEmail.isPending,
  });

  const onSubmit = async (values: SetEmailBody) => {
    try {
      await setEmail.mutateAsync({ id: staff.id, body: values });
      form.reset();
      onClose();
    } catch (error) {
      applyServerErrors(error, form.setError, {
        fields: Object.keys(emailFields),
        codeFields: EMAIL_ERROR_FIELDS,
        messageForError,
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
      title={t("changeEmail.title", { email: staff.email })}
      description={t("changeEmail.description")}
      form={form}
      fields={emailFields}
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

export { emailFields as changeStaffEmailFields };
