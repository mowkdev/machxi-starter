import { zodResolver } from "@hookform/resolvers/zod";
import {
  updateUserBody,
  type UpdateUserBody,
  type UserResource,
} from "@repo/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";

import {
  UserFormInput,
  useUpdateUser,
  useUser,
  userResourceConfig,
} from "@/entities/user";
import { AppFormSurface } from "@/shared/form/app-form-surface";
import { applyServerErrors } from "@/shared/form/server-errors";
import {
  dirtyValuesOf,
  editSurfaceOf,
  fieldsForVariant,
} from "@/shared/resource/config";

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
  const navigate = useNavigate();
  const updateUser = useUpdateUser();

  /** Back to the list, page and filters intact (ADR-0040). */
  const close = () => {
    void navigate({ to: "/users", search: true });
  };

  // The loader primed this key, so it resolves warm; it stays a subscription so
  // an invalidation under the open surface is noticed.
  const detail = useUser(user.id);

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
      });
    }
  };

  return (
    <AppFormSurface
      surface={editSurfaceOf(userResourceConfig)}
      onClose={close}
      title={`Edit ${user.email}`}
      description="Email is not editable — changing the identifier a session was established with is its own flow."
      form={form}
      fields={userResourceConfig.fields}
      variant="edit"
      onSubmit={onSubmit}
      isPending={updateUser.isPending}
      submitLabel="Save changes"
      canSubmit={form.formState.isDirty}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <UserFormInput fieldName="firstName" />
        <UserFormInput fieldName="lastName" />
      </div>
      <UserFormInput fieldName="status" />
    </AppFormSurface>
  );
};
