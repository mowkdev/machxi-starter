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

import { useInvalidateOwnStaffRow } from "./use-invalidate-own-staff-row";

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
    label: "profile:password.fields.currentPassword.label",
    component: "input",
    // The one thing here that a password manager should offer to fill.
    props: { type: "password", autoComplete: "current-password" },
    description: "profile:password.fields.currentPassword.description",
  },
  newPassword: {
    label: "profile:password.fields.newPassword.label",
    component: "input",
    /*
     * `new-password`, and the contrast with the two reset forms is the point.
     * D3.7 refused it there because those boxes held the *subject's*
     * credential and a saved copy would have been somebody else's password
     * filed in the acting admin's vault. This box holds the credential of the
     * person typing it, so offering to save it is the browser doing its job.
     */
    props: { type: "password", autoComplete: "new-password" },
    description: "profile:password.fields.newPassword.description",
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
  const { t } = useT("profile");
  const changePassword = useChangePassword();
  const messageForError = useMessageForError();
  const invalidateOwnStaffRow = useInvalidateOwnStaffRow();
  const { principal } = useSession();

  const form = useForm<ChangePasswordBody>({
    resolver: zodResolver(changePasswordBody),
    defaultValues: { currentPassword: "", newPassword: "" },
    disabled: changePassword.isPending,
  });

  const onSubmit = async (values: ChangePasswordBody) => {
    try {
      await changePassword.mutateAsync(values);
      // The password write stamps `updatedAt` on this operator's own staff row.
      invalidateOwnStaffRow();
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
         * The same schema, caught a second time and in this operator's
         * language (`D7.5`, ADR-0046 §6). A detail whose path this form
         * renders is answered by the schema the form validates with rather
         * than echoed from the wire, because the wire's English is the API's
         * and not necessarily the operator's.
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
       * The identity anchor a password manager needs (D3.9 review). Two
       * password boxes and no username gives it nothing to key the update on,
       * and an operator with more than one saved credential for this origin —
       * their own plus a break-glass account is normal here — gets the wrong
       * entry updated or a duplicate saved, either of which leaves a vault
       * entry that no longer opens the account. `login-form` already does this
       * with a real field; here the value is not the operator's to edit, so it
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
