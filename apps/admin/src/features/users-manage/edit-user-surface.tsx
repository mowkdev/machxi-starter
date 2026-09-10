import { zodResolver } from "@hookform/resolvers/zod";
import {
  updateUserBody,
  type UpdateUserBody,
  type UserResource,
} from "@repo/contracts";
import { useNavigate } from "@tanstack/react-router";

import { useRecordNavigation } from "@/shared/grid/record-navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import {
  UserFormInput,
  useUpdateUser,
  useUser,
  userResourceConfig,
} from "@/entities/user";
import { useCan } from "@/shared/auth";
import { AppFormSurface } from "@/shared/form/app-form-surface";
import { useT } from "@/shared/i18n";
import {
  applyServerErrors,
  schemaFieldRules,
} from "@/shared/form/server-errors";
import { useMessageForError } from "@/shared/notifications/messages";
import {
  dirtyValuesOf,
  editSurfaceOf,
  fieldsForVariant,
} from "@/shared/resource/config";
import {
  Button,
  Field,
  FieldContent,
  FieldDescription,
  FieldTitle,
} from "@/shared/ui";

import { ChangeUserEmailDialog } from "./change-user-email-dialog";

/**
 * `PATCH /admin/users/:id` — names and status.
 *
 * The one refusal this form can meet that the staff form cannot is
 * `409 USER_DELETED`: a soft-deleted account is read-only (ADR-0028), reads
 * keep working so an admin who was shown the row can still open it, and the
 * write path is what stops. It is **not** pre-guessed from the `deletedAt` the
 * row carries — the row is a page that may be minutes old, the API is the
 * enforcement point, and the refusal has a sentence written for it in the
 * ADR-0034 map. What the client does with `deletedAt` is *show* it, which is
 * the honest division: the grid marks the account, the server refuses the
 * write.
 */

/** What the edit form puts on screen — the config decides, not this file. */
const FIELD_NAMES = fieldsForVariant(userResourceConfig.fields, "edit").map(
  ([name]) => name,
);

/** The user as this form's values. `null` is a real value here, not a gap. */
const toFormValues = (user: UserResource): UpdateUserBody => ({
  firstName: user.firstName,
  lastName: user.lastName,
  status: user.status,
});

export const EditUserSurface = ({
  user,
}: {
  /** The record the route loaded (`D4.2`, ADR-0040). */
  readonly user: UserResource;
}) => {
  const { t } = useT("users");
  const navigate = useNavigate();
  const { closeSearch } = useRecordNavigation();
  const updateUser = useUpdateUser();
  const messageForError = useMessageForError();

  /** Back to the list, page and filters intact (ADR-0040). */
  /*
   * The way back is history state, not the URL (ADR-0044, `D5.3`): this record
   * carries no list params, so the view the operator left comes from the
   * navigation that opened it. A record reached by a link from somebody else
   * carries none, and closes to the bare list — which is honest, because the
   * recipient never had the sender's view.
   */
  const close = () => {
    void navigate({ to: "/users", search: closeSearch });
  };

  // The loader primed this key, so it resolves warm; it stays a subscription so
  // an invalidation under the open surface is noticed — which is what makes the
  // address below update the moment the ceremony beside it lands.
  const detail = useUser(user.id);

  /** The address ceremony, ephemeral for ADR-0040's reason: it is not a link. */
  const [changingEmail, setChangingEmail] = useState(false);

  const form = useForm<UpdateUserBody>({
    resolver: zodResolver(updateUserBody),
    defaultValues: toFormValues(user),
    values: toFormValues(detail.data ?? user),
    // Untouched fields take the fresh value, touched ones are left alone.
    resetOptions: { keepDirtyValues: true },
    disabled: updateUser.isPending,
  });

  const onSubmit = async (values: UpdateUserBody) => {
    /*
     * Pruned to what changed (ADR-0035) — and here that is also what carries
     * the difference between "leave this name" and "clear it". A cleared
     * control submits `null` because the config says the field is `nullable`,
     * `null` differs from the value it was seeded with, so it is dirty and the
     * key travels; an untouched one does not.
     */
    const body = dirtyValuesOf(values, form.formState.dirtyFields);

    if (Object.keys(body).length === 0) {
      close();
      return;
    }

    try {
      await updateUser.mutateAsync({ id: user.id, body });
      close();
    } catch (error) {
      applyServerErrors(error, form.setError, {
        fields: FIELD_NAMES,
        codeFields: userResourceConfig.errorFields,
        messageForError,
        /*
         * The same schema, caught a second time and in this operator's
         * language (`D7.5`, ADR-0046 §6). A detail whose path this form
         * renders is answered by the schema the form validates with rather
         * than echoed from the wire, because the wire's English is the API's
         * and not necessarily the operator's.
         */
        rules: schemaFieldRules(updateUserBody, form.getValues()),
      });
    }
  };

  const record = detail.data ?? user;

  return (
    /*
     * The ceremony is a **sibling** of the surface, not a child of it
     * (`D18.10`). Both are Radix dialogs and both would work nested in the
     * DOM — Radix portals each one to `document.body` — but a React portal
     * still bubbles synthetic events up the *React* tree, so a submit inside a
     * dialog rendered under `AppFormSurface` would reach this surface's own
     * `<form>` and save the record as a side effect of changing an address.
     * Siblings cannot do that. The trigger stays inside, where the operator
     * looks for it; only the dialog moves out.
     */
    <>
      <AppFormSurface
        surface={editSurfaceOf(userResourceConfig)}
        onClose={close}
        // `record`, not the loader's snapshot: a successful address change
        // invalidates the detail query but does not re-run the loader, so
        // `user.email` would leave the heading naming an address the field
        // directly beneath it has already replaced (`D18.10`'s `code-reviewer`).
        title={t("edit.title", { email: record.email })}
        description={t("edit.description")}
        form={form}
        fields={userResourceConfig.fields}
        variant="edit"
        onSubmit={onSubmit}
        isPending={updateUser.isPending}
        submitLabel={t("edit.submit")}
        canSubmit={form.formState.isDirty}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <UserFormInput fieldName="firstName" />
          <UserFormInput fieldName="lastName" />
        </div>
        <UserFormInput fieldName="status" />
        <ChangeEmailField
          email={record.email}
          onOpen={() => {
            setChangingEmail(true);
          }}
        />
      </AppFormSurface>

      {changingEmail ? (
        <ChangeUserEmailDialog
          user={record}
          onClose={() => {
            setChangingEmail(false);
          }}
        />
      ) : null}
    </>
  );
};

/**
 * The address, and the way to change it — `super_admin` only (ADR-0071 §7,
 * ADR-0042).
 *
 * **Absent rather than shown-and-refused**, which is the opposite of what this
 * app does with reset password and sign out everywhere. Those two stay visible
 * to a `manager` because they are what somebody reaches for *during* an
 * incident, and a hidden control is a silent absence with nothing to escalate
 * (ADR-0042 §Containment controls). Setting an address is not that: it is a
 * deliberate correction with somebody to ask, and an operator who cannot make
 * it loses nothing by not seeing it.
 *
 * It reads `email` rather than editing it, because `updateUserBody` has no such
 * field and this is a sub-resource with a guard of its own — which is what the
 * surrounding form's description means by "its own flow".
 */
const ChangeEmailField = ({
  email,
  onOpen,
}: {
  readonly email: string;
  readonly onOpen: () => void;
}) => {
  const { t } = useT("users");
  const can = useCan();

  if (!can("changeEmail", "users")) return null;

  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldTitle>{t("changeEmail.field.label")}</FieldTitle>
        <FieldDescription className="break-all">{email}</FieldDescription>
      </FieldContent>
      {/*
       * `type="button"`, load-bearing: this sits inside the surface's `<form>`,
       * where the default type would submit the record on the way to opening a
       * dialog about something else.
       */}
      <Button onClick={onOpen} size="sm" type="button" variant="outline">
        {t("changeEmail.action")}
      </Button>
    </Field>
  );
};
