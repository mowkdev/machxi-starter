import { zodResolver } from "@hookform/resolvers/zod";
import {
  changeEmailBody,
  type ChangeEmailBody,
  type ErrorCode,
} from "@repo/contracts";
import { useForm } from "react-hook-form";

import { useChangeEmail } from "@/entities/profile";
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
 * `POST /user/profile/change-email` — a customer asking to move their account
 * to a new address (`D18.9`; ADR-0071 §6).
 *
 * **A dialog rather than a field on the details form**, and the reason is the
 * endpoint's rather than this screen's: `updateProfileBody` cannot carry an
 * address at all, because a profile edit is reachable inside an impersonated
 * session and a change of address is not (ADR-0057 §5). What the API models as
 * a sub-resource the interface models as a ceremony — ADR-0040's rule, and the
 * same one `change-password` sits under: it asks for a credential, it has no
 * state worth returning to, and it must not be deep-linkable.
 *
 * **What it starts is not what it finishes.** The submit answers `202` and
 * changes nothing; a link goes to the address just typed, and the account
 * moves when somebody follows it. The dialog's own copy has to say so, because
 * a form that closes with a toast reading "saved" would be a lie about the one
 * thing this flow gets right.
 *
 * The field map lives in this feature and not on the profile's config
 * (ADR-0035): an address the account does not hold yet is not an attribute of
 * the account. `variant="action"` is what says so in the vocabulary.
 */
export const changeEmailFields = {
  newEmail: {
    label: "profile:email.fields.newEmail.label",
    component: "input",
    // `type="email"` for the keyboard on a phone and the browser's own hint;
    // `autoComplete="email"` so a password manager offers addresses rather
    // than nothing. Not `username`: that would invite it to file this as a new
    // credential for a site the person has not moved to yet.
    props: { type: "email", autoComplete: "email" },
    description: "profile:email.fields.newEmail.description",
  },
  currentPassword: {
    label: "profile:email.fields.currentPassword.label",
    component: "input",
    props: { type: "password", autoComplete: "current-password" },
    description: "profile:email.fields.currentPassword.description",
  },
} as const satisfies FieldConfigMap<ChangeEmailBody>;

const EmailFormInput = createAppFormInput(changeEmailFields);

/**
 * The two codes this form can put under a field, and which field each answers.
 *
 * `AUTH_CURRENT_PASSWORD_INVALID` is a `403` with no `details` — the condition
 * belongs to the credential check rather than to a request field (ADR-0027
 * §Contracts) — and `USER_EMAIL_TAKEN` is a `409` with none either. Both have
 * an obvious box a person can act on, and putting the sentence there is the
 * difference between "try again" and knowing what to retype.
 */
const EMAIL_ERROR_FIELDS: Readonly<Partial<Record<ErrorCode, string>>> = {
  AUTH_CURRENT_PASSWORD_INVALID: "currentPassword",
  USER_EMAIL_TAKEN: "newEmail",
};

export const ChangeEmailDialog = ({
  onClose,
}: {
  readonly onClose: () => void;
}) => {
  const { t } = useT("profile");
  const changeEmail = useChangeEmail();
  const messageForError = useMessageForError();
  const { principal } = useSession();

  const form = useForm<ChangeEmailBody>({
    resolver: zodResolver(changeEmailBody),
    defaultValues: { newEmail: "", currentPassword: "" },
    disabled: changeEmail.isPending,
  });

  const onSubmit = async (values: ChangeEmailBody) => {
    try {
      await changeEmail.mutateAsync(values);
      // Before `onClose`, so the plaintext password is gone from the form
      // state whether or not React unmounts the dialog this tick.
      form.reset();
      onClose();
    } catch (error) {
      applyServerErrors(error, form.setError, {
        fields: Object.keys(changeEmailFields),
        codeFields: EMAIL_ERROR_FIELDS,
        messageForError,
        // The same schema, caught a second time and in this customer's
        // language (ADR-0046 §6) — the address format above all, which the
        // API answers as a `details` path.
        rules: schemaFieldRules(changeEmailBody, form.getValues()),
      });
    }
  };

  return (
    <AppFormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("email.dialog.title")}
      description={t("email.dialog.description")}
      form={form}
      fields={changeEmailFields}
      variant="action"
      onSubmit={onSubmit}
      isPending={changeEmail.isPending}
      submitLabel={t("email.dialog.submit")}
    >
      {/*
       * The identity anchor a password manager needs, exactly as the password
       * dialog carries it: a password box with no username beside it gives the
       * manager nothing to key on. It is the address the account **currently**
       * uses, because that is the entry the typed password belongs to; the new
       * one is not a credential for anything yet.
       */}
      <input
        aria-hidden
        autoComplete="username"
        hidden
        readOnly
        tabIndex={-1}
        value={principal?.email ?? ""}
      />
      <EmailFormInput fieldName="newEmail" />
      <EmailFormInput fieldName="currentPassword" />
    </AppFormDialog>
  );
};
