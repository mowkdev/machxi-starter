import { zodResolver } from "@hookform/resolvers/zod";
import {
  deleteProfileBody,
  type DeleteProfileBody,
  type ErrorCode,
} from "@repo/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";

import { useDeleteProfile } from "@/entities/profile";
import { useApiClient } from "@/shared/api/context";
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
 * `DELETE /user/profile` — a customer closing their own account (`D12.8`;
 * ADR-0055 §4, ADR-0028's user semantics).
 *
 * **A form dialog rather than the admin's `ConfirmDialog`**, and the password
 * is the whole reason: ADR-0055 §4 requires the actor to re-authenticate, so
 * this ceremony has a field, a schema and a refusal that has to land beside
 * that field — which is the shape ADR-0035 describes and the confirm has no
 * room for. It is a ceremony all the same, so it is a dialog and not a route
 * (ADR-0040): there is no state worth returning to and an address that opens
 * the delete form is a link somebody can be sent.
 *
 * **The consequences are listed rather than summarised**, because ADR-0028's
 * user semantics are not what "delete" usually implies and a customer agreeing
 * to the wrong thing is the failure that matters here: the row survives (future
 * order history references it), the address is released by the partial unique
 * index, every session ends including this one, and there is no restore
 * endpoint in v1 — so nothing in this app can undo it. Each of those is a
 * sentence in the catalogue rather than a shorter, friendlier claim.
 *
 * **The submit is the shell's default button and not a destructive one.**
 * `AppFormDialog` renders `AppFormActions`, which has one submit style; the
 * most destructive action this app has therefore draws in the primary style.
 * That is recorded as the plan's finding 11 rather than fixed here, because
 * fixing it is a `@repo/form` diff and this deliverable names such a diff
 * before it makes one. What carries the weight in the meantime is the copy:
 * the card's button, the dialog's title and its list all say what happens.
 */
export const deleteAccountFields = {
  currentPassword: {
    label: "profile:delete.fields.currentPassword.label",
    component: "input",
    props: { type: "password", autoComplete: "current-password" },
    description: "profile:delete.fields.currentPassword.description",
  },
} as const satisfies FieldConfigMap;

const DeleteFormInput = createAppFormInput(deleteAccountFields);

/**
 * `AUTH_CURRENT_PASSWORD_INVALID` is a `403` with no `details` — the condition
 * belongs to the credential check rather than to a request field (ADR-0027
 * §Contracts) — and the only box on this form is the one that has to change.
 */
const DELETE_ERROR_FIELDS: Readonly<Partial<Record<ErrorCode, string>>> = {
  AUTH_CURRENT_PASSWORD_INVALID: "currentPassword",
};

/** The consequences, in the order a customer needs them. */
const CONSEQUENCES = [
  "delete.consequences.signedOut",
  "delete.consequences.noSignIn",
  "delete.consequences.email",
  "delete.consequences.kept",
] as const;

export const DeleteAccountDialog = ({
  onClose,
}: {
  readonly onClose: () => void;
}) => {
  const { t } = useT("profile");
  const deleteProfile = useDeleteProfile();
  const messageForError = useMessageForError();
  const client = useApiClient();
  const navigate = useNavigate();

  const form = useForm<DeleteProfileBody>({
    resolver: zodResolver(deleteProfileBody),
    defaultValues: { currentPassword: "" },
    disabled: deleteProfile.isPending,
  });

  const onSubmit = async (values: DeleteProfileBody) => {
    try {
      await deleteProfile.mutateAsync(values);
    } catch (error) {
      applyServerErrors(error, form.setError, {
        fields: Object.keys(deleteAccountFields),
        codeFields: DELETE_ERROR_FIELDS,
        messageForError,
        rules: schemaFieldRules(deleteProfileBody, form.getValues()),
      });

      /*
       * Only the request is inside the `try`. A rejection from the navigation
       * below is a routing failure, and running `applyServerErrors` over one
       * would report it as a refusal on the password box.
       */
      return;
    }

    // Before anything else, so the plaintext is gone from the form state
    // whether or not React gets around to unmounting this dialog.
    form.reset();
    onClose();

    /*
     * The client's half of "signed out everywhere" (ADR-0055 §4 as amended at
     * `D12.4`). The server revoked every session and cleared the auth cookies;
     * what is left in this tab is an access token in memory and a principal,
     * and leaving them there would keep the guards believing in an account
     * that no longer exists.
     *
     * The navigation is explicit rather than left to the guard, for
     * `useSignOut`'s reason: `endSession` invalidates the router and
     * `_dashboard` would bounce the customer anyway, but to the `redirect`
     * that guard computed — sending someone who just closed their account back
     * to `/account/security` the moment they sign in as somebody else.
     */
    client.endSession();
    void navigate({ to: "/login", search: {} });
  };

  return (
    <AppFormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("delete.dialog.title")}
      description={t("delete.dialog.description")}
      form={form}
      fields={deleteAccountFields}
      variant="action"
      onSubmit={onSubmit}
      isPending={deleteProfile.isPending}
      submitLabel={t("delete.dialog.submit")}
    >
      {/*
       * No hidden `username` anchor, unlike the change-password dialog. That
       * one exists so a password manager can key an *update* on the right
       * vault entry; nothing here asks the browser to save anything, and an
       * identity field on a form whose purpose is to end that identity would
       * be inviting exactly the wrong offer.
       */}
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {CONSEQUENCES.map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ul>
      <DeleteFormInput fieldName="currentPassword" />
    </AppFormDialog>
  );
};
