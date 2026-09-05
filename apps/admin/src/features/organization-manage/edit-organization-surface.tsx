import { zodResolver } from "@hookform/resolvers/zod";
import {
  updateOrganizationBody,
  type UpdateOrganizationBody,
  type OrganizationResource,
} from "@repo/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";

import {
  OrganizationFormInput,
  organizationResourceConfig,
  useUpdateOrganization,
  useOrganization,
} from "@/entities/organization";
import { AppFormSurface } from "@/shared/form/app-form-surface";
import {
  applyServerErrors,
  schemaFieldRules,
} from "@/shared/form/server-errors";
import { useRecordNavigation } from "@/shared/grid/record-navigation";
import { useT } from "@/shared/i18n";
import { useMessageForError } from "@/shared/notifications/messages";
import {
  dirtyValuesOf,
  editSurfaceOf,
  fieldsForVariant,
} from "@/shared/resource/config";

/**
 * `PATCH /organizations/:id` — the same field configuration as the create form,
 * rendered under `variant="edit"`.
 *
 * One declaration, two forms, and no way for them to disagree about what a
 * organization is: a field the config marks create-only disappears here, and one it
 * marks edit-only appears.
 *
 * **The record arrives from the route loader, not from the row that was
 * clicked** (ADR-0040). That is what the URL buys: `/organizations/$id`
 * is reachable by reload, by Back and by somebody else's link, and in none of
 * those cases is there a grid row to hand over.
 */

/** What the edit form puts on screen — the config decides, not this file. */
const FIELD_NAMES = fieldsForVariant(
  organizationResourceConfig.fields,
  "edit",
).map(([name]) => name);

/**
 * The record's own values, for the two fields this form may move.
 *
 * `ownerId` is deliberately absent: it is on the create body and not on this
 * one, because moving ownership is a membership write on the sub-resource
 * rather than a property of the organization (ADR-0067 §2, §3).
 */
const toFormValues = (
  organization: OrganizationResource,
): UpdateOrganizationBody => ({
  name: organization.name,
  slug: organization.slug,
});

export const EditOrganizationSurface = ({
  organization,
}: {
  /** The record the route loaded. */
  readonly organization: OrganizationResource;
}) => {
  const { t } = useT("organizations");
  const navigate = useNavigate();
  const { closeSearch } = useRecordNavigation();
  const updateOrganization = useUpdateOrganization();
  const messageForError = useMessageForError();

  const close = () => {
    void navigate({ to: "/organizations", search: closeSearch });
  };

  /*
   * The same key the loader primed, so this resolves from cache on the first
   * render and refetches only when ADR-0034's `staleTime` says it is worth it.
   * It stays a `useQuery` rather than reading the loader's value once, because
   * a subscription is what notices the cache being invalidated underneath.
   */
  const detail = useOrganization(organization.id);

  const form = useForm<UpdateOrganizationBody>({
    resolver: zodResolver(updateOrganizationBody),
    defaultValues: toFormValues(organization),
    /*
     * `values` + `keepDirtyValues` is RHF's own answer to "the server told us
     * something newer while the operator was typing": untouched fields take the
     * fresh value, touched ones are left alone.
     */
    values: toFormValues(detail.data ?? organization),
    resetOptions: { keepDirtyValues: true },
    disabled: updateOrganization.isPending,
  });

  const onSubmit = async (values: UpdateOrganizationBody) => {
    /*
     * Pruned to what the operator actually changed (ADR-0035), which is what
     * makes the contract's "provide at least one field" refinement measure a
     * real edit — and what stops a re-send of every seeded value overwriting a
     * field somebody else changed in the meantime.
     */
    const body = dirtyValuesOf(values, form.formState.dirtyFields);

    // Unreachable through the disabled button, kept because implicit submission
    // from a text field is not consistently blocked by it — and an empty body
    // is a `VALIDATION_ERROR` the operator did nothing to earn.
    if (Object.keys(body).length === 0) {
      close();
      return;
    }

    try {
      await updateOrganization.mutateAsync({ id: organization.id, body });
      close();
    } catch (error) {
      applyServerErrors(error, form.setError, {
        fields: FIELD_NAMES,
        codeFields: organizationResourceConfig.errorFields,
        messageForError,
        rules: schemaFieldRules(updateOrganizationBody, form.getValues()),
      });
    }
  };

  return (
    <AppFormSurface
      surface={editSurfaceOf(organizationResourceConfig)}
      onClose={close}
      title={t("edit.title", { name: organization.name })}
      description={t("edit.description")}
      form={form}
      fields={organizationResourceConfig.fields}
      variant="edit"
      onSubmit={onSubmit}
      isPending={updateOrganization.isPending}
      submitLabel={t("edit.submit")}
      // Nothing changed is nothing to send, and saying so on the button is
      // kinder than a validation error that says the same thing afterwards.
      canSubmit={form.formState.isDirty}
    >
      <OrganizationFormInput fieldName="name" />
      {/*
        A `personal` organization's address is derived from its account and the
        API refuses a change to it with `409` (ADR-0067 §2). The control is
        rendered either way rather than hidden by kind: the refusal is the
        API's, `errorFields` puts it under this box, and a control that
        vanished for one row's kind would be a second rule to keep in step with
        the first.
      */}
      <OrganizationFormInput fieldName="slug" />
    </AppFormSurface>
  );
};
