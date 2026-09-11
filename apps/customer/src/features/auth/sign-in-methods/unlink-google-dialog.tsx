import { zodResolver } from "@hookform/resolvers/zod";
import {
  unlinkIdentityBody,
  type ErrorCode,
  type UnlinkIdentityBody,
} from "@repo/contracts";
import { useForm } from "react-hook-form";

import { useUnlinkIdentity } from "@/entities/profile";
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
 * `DELETE /user/profile/identities/google` — the owner removing Google as a
 * way in (ADR-0072 §3).
 *
 * **A form dialog, the deletion dialog's shape for its reason**: ADR-0027's
 * rule asks the current password wherever a credential is removed, so the
 * ceremony has a field, a schema and refusals that must land in it.
 *
 * The API answers in a fixed order and each answer has a place. `403
 * AUTH_CURRENT_PASSWORD_INVALID` is the password box's. `409
 * AUTH_LAST_CREDENTIAL` — the account has no password, so Google is its only
 * way in — belongs to no field, and lands as the dialog's own sentence: the
 * security section never opens this dialog for such an account, so a person
 * meets it only from a stale screen, and the catalogue's sentence tells them
 * what to do. Either refusal keeps the dialog open; `204` closes it, and the
 * profile's invalidation takes the row away.
 */
export const unlinkGoogleFields = {
  currentPassword: {
    label: "profile:methods.unlink.fields.currentPassword.label",
    component: "input",
    props: { type: "password", autoComplete: "current-password" },
    description: "profile:methods.unlink.fields.currentPassword.description",
  },
} as const satisfies FieldConfigMap<UnlinkIdentityBody>;

const UnlinkFormInput = createAppFormInput(unlinkGoogleFields);

const UNLINK_ERROR_FIELDS: Readonly<Partial<Record<ErrorCode, string>>> = {
  AUTH_CURRENT_PASSWORD_INVALID: "currentPassword",
};

export const UnlinkGoogleDialog = ({
  onClose,
}: {
  readonly onClose: () => void;
}) => {
  const { t } = useT("profile");
  const unlink = useUnlinkIdentity();
  const messageForError = useMessageForError();

  const form = useForm<UnlinkIdentityBody>({
    resolver: zodResolver(unlinkIdentityBody),
    defaultValues: { currentPassword: "" },
    disabled: unlink.isPending,
  });

  const onSubmit = async (values: UnlinkIdentityBody) => {
    try {
      await unlink.mutateAsync({ provider: "google", body: values });
    } catch (error) {
      applyServerErrors(error, form.setError, {
        fields: Object.keys(unlinkGoogleFields),
        codeFields: UNLINK_ERROR_FIELDS,
        messageForError,
        rules: schemaFieldRules(unlinkIdentityBody, form.getValues()),
      });

      return;
    }

    // The plaintext leaves the form state before the dialog does.
    form.reset();
    onClose();
  };

  return (
    <AppFormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("methods.unlink.title")}
      description={t("methods.unlink.description")}
      form={form}
      fields={unlinkGoogleFields}
      variant="action"
      onSubmit={onSubmit}
      isPending={unlink.isPending}
      submitLabel={t("methods.unlink.submit")}
    >
      <UnlinkFormInput fieldName="currentPassword" />
    </AppFormDialog>
  );
};
