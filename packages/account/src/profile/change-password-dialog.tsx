import { zodResolver } from "@hookform/resolvers/zod";
import { useSession, type ErrorMessage } from "@repo/api-client";
import {
  changePasswordBody,
  type ChangePasswordBody,
  type ErrorCode,
} from "@repo/contracts";
import {
  AppFormDialog,
  applyServerErrors,
  createAppFormInput,
  schemaFieldRules,
} from "@repo/form";
import { useKeyT, useT, type TranslationKey } from "@repo/i18n";
import type { FieldConfigMap } from "@repo/resource";
import { useForm } from "react-hook-form";

/**
 * The three sentences the two apps word differently (`D22.2`, ADR-0077 §2).
 *
 * An operator is told about "sessions" and a customer about "devices", so
 * these stay in each app's own catalogue and arrive as keys. Every other word
 * in the dialog was the same in both apps and both locales, and travels in
 * this package's namespace.
 */
export interface ChangePasswordCopy {
  readonly dialogDescription: TranslationKey;
  readonly currentPasswordDescription: TranslationKey;
  readonly newPasswordDescription: TranslationKey;
}

/**
 * The dialog's field map (ADR-0035).
 *
 * It lives with the feature and not on the profile's own config: a credential
 * is not an attribute of the account, which is why the endpoint is a
 * sub-resource and not a field on `PATCH /profile`. `variant="action"` is what
 * says so in the vocabulary.
 *
 * **Both passwords are the caller's own**, so the browser is told the truth
 * through `autoComplete` and the "save this password?" prompt that follows is
 * the correct outcome. The admin's two administrative reset forms refuse
 * those hints because their boxes hold a *third party's* credential.
 */
export const createChangePasswordFields = (copy: ChangePasswordCopy) =>
  ({
    currentPassword: {
      label: "accountClient:password.fields.currentPassword.label",
      component: "input",
      // The one thing here that a password manager should offer to fill.
      props: { type: "password", autoComplete: "current-password" },
      description: copy.currentPasswordDescription,
    },
    newPassword: {
      label: "accountClient:password.fields.newPassword.label",
      component: "input",
      props: { type: "password", autoComplete: "new-password" },
      description: copy.newPasswordDescription,
    },
  }) as const satisfies FieldConfigMap<ChangePasswordBody>;

/**
 * `AUTH_CURRENT_PASSWORD_INVALID` is a `403` with no `details` — the condition
 * belongs to the credential check rather than to a request field (ADR-0027
 * §Contracts) — but the question a person has is "what do I retype?", and the
 * answer is the first box.
 */
const PASSWORD_ERROR_FIELDS: Readonly<Partial<Record<ErrorCode, string>>> = {
  AUTH_CURRENT_PASSWORD_INVALID: "currentPassword",
};

/** Nothing else changed: the default for an app that passes no `useAfterChange`. */
const useNothingAfter = (): (() => void) => nothing;
const nothing = (): void => undefined;

export interface ChangePasswordDeps {
  readonly copy: ChangePasswordCopy;
  /** The app's own profile entity's mutation, on its own segment. */
  readonly useChangePassword: () => {
    readonly mutateAsync: (body: ChangePasswordBody) => Promise<unknown>;
    readonly isPending: boolean;
  };
  /** The app's code map over its own `errors` catalogue (ADR-0034). */
  readonly useMessageForError: () => ErrorMessage;
  /**
   * What else this write made stale, where an app has such a thing: in the
   * admin the acting operator is also a row in `/admin/staff`, and the feature
   * is the layer allowed to see both entities.
   */
  readonly useAfterChange?: (() => () => void) | undefined;
}

/**
 * `POST /<segment>/profile/change-password` — a person changing their own
 * credential (ADR-0027 §Self-service) — one dialog for both apps since
 * `D22.2` (ADR-0077 §2).
 *
 * A dialog rather than a section of the page, and the reason is ADR-0040's:
 * a password change is a **ceremony** — it has no state worth returning to and
 * must not be deep-linkable.
 */
export const createChangePasswordDialog = ({
  copy,
  useChangePassword,
  useMessageForError,
  useAfterChange = useNothingAfter,
}: ChangePasswordDeps) => {
  const changePasswordFields = createChangePasswordFields(copy);
  const PasswordFormInput = createAppFormInput(changePasswordFields);

  const ChangePasswordDialog = ({
    onClose,
  }: {
    readonly onClose: () => void;
  }) => {
    const { t } = useT("accountClient");
    const tk = useKeyT();
    const changePassword = useChangePassword();
    const messageForError = useMessageForError();
    const afterChange = useAfterChange();
    const { principal } = useSession();

    const form = useForm<ChangePasswordBody>({
      resolver: zodResolver(changePasswordBody),
      defaultValues: { currentPassword: "", newPassword: "" },
      disabled: changePassword.isPending,
    });

    const onSubmit = async (values: ChangePasswordBody) => {
      try {
        await changePassword.mutateAsync(values);
        afterChange();
        // Before `onClose`, so the plaintext is gone from the form state
        // whether or not React gets around to unmounting the dialog this tick.
        form.reset();
        onClose();
      } catch (error) {
        applyServerErrors(error, form.setError, {
          fields: Object.keys(changePasswordFields),
          codeFields: PASSWORD_ERROR_FIELDS,
          messageForError,
          /*
           * The same schema, caught a second time and in the reader's
           * language (`D7.5`, ADR-0046 §6). A detail whose path this form
           * renders is answered by the schema the form validates with rather
           * than echoed from the wire, because the wire's English is the
           * API's. `passwordMustDiffer` is the refinement this matters most
           * for: the API answers it as a `details` path.
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
        description={tk(copy.dialogDescription)}
        form={form}
        fields={changePasswordFields}
        variant="action"
        onSubmit={onSubmit}
        isPending={changePassword.isPending}
        submitLabel={t("password.dialog.submit")}
      >
        {/*
         * The identity anchor a password manager needs (D3.9 review). Two
         * password boxes and no username gives it nothing to key the update
         * on, so it either updates the wrong saved entry or files a duplicate
         * — and either leaves a vault entry that no longer opens the account.
         * The value is not the person's to edit, so it is present and hidden
         * rather than shown. `hidden` is a hint a browser may ignore, like
         * the `autoComplete` values themselves.
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

  return { ChangePasswordDialog, changePasswordFields } as const;
};
