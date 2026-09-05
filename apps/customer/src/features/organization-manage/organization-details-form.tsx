import { zodResolver } from "@hookform/resolvers/zod";
import {
  updateOrganizationBody,
  type ErrorCode,
  type OrganizationResource,
  type UpdateOrganizationBody,
} from "@repo/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";

import {
  OrganizationFormInput,
  organizationFields,
  useUpdateOrganization,
} from "@/entities/organization";
import { AppFormProvider } from "@/shared/form/context";
import { AppFormError } from "@/shared/form/form-error";
import {
  applyServerErrors,
  schemaFieldRules,
} from "@/shared/form/server-errors";
import { useT } from "@/shared/i18n";
import { useMessageForError } from "@/shared/notifications/messages";
import { dirtyValuesOf } from "@/shared/resource/config";
import { Button, FieldGroup, FieldSet, Spinner } from "@/shared/ui";

/**
 * `PATCH /user/orgs/:orgId` — an organization's name and address (ADR-0067 §7).
 *
 * The profile details form's shape, and deliberately so: an inline form on a
 * settings screen, assembling by hand the four things `AppFormDialog` would
 * own — the provider, the `FieldSet disabled aria-busy` half of ADR-0035's
 * submit lock, `AppFormError`, and the submit row. **This is the second inline
 * form in this app**, which is what `profile-details-form` said would promote a
 * shared frame; the promotion is deliberately not taken here, because the two
 * differ in the one place a frame would have to be right — this one navigates
 * when it succeeds and that one does not. A frame that took an `onSuccess`
 * callback would be a frame with one line of chrome and one line of policy.
 *
 * **A slug edit moves the page.** The address in the URL is the organization's
 * slug (ADR-0067 §6), so saving a new one leaves the browser on a path that no
 * longer resolves — a not-found the moment the switcher's list comes back. The
 * navigation is this form's rather than the entity hook's, for ADR-0049's
 * boundary: where a customer goes next is routing.
 */

/** The fields this form renders. */
const FIELD_NAMES = Object.keys(organizationFields);

/**
 * A taken address, put under the box that caused it (ADR-0035).
 *
 * `CONFLICT` is a `409` with no `details` — the conflict is about the address
 * rather than about a zod issue — and the question it answers is "which box do
 * I change?".
 *
 * **`ORGANIZATION_PERSONAL_UNDELETABLE` was mapped here and is not**, which is
 * a review finding: the service answers it for a personal organization's slug,
 * and this form does not render a slug field for a personal organization at
 * all. Mapping a code onto a control that is not on screen, with
 * `errorToast: false` beside it, is a refusal delivered nowhere. It falls
 * through to `AppFormError`, which is mounted.
 */
const ORGANIZATION_ERROR_FIELDS: Readonly<Partial<Record<ErrorCode, string>>> =
  {
    CONFLICT: "slug",
  };

const toFormValues = (
  organization: OrganizationResource,
): UpdateOrganizationBody => ({
  name: organization.name,
  slug: organization.slug,
});

export const OrganizationDetailsForm = ({
  organization,
}: {
  readonly organization: OrganizationResource;
}) => {
  const { t } = useT("organizations");
  const navigate = useNavigate();
  const updateOrganization = useUpdateOrganization(organization.id);
  const messageForError = useMessageForError();

  const form = useForm<UpdateOrganizationBody>({
    resolver: zodResolver(updateOrganizationBody),
    defaultValues: toFormValues(organization),
    /*
     * `values` + `keepDirtyValues`, the profile form's pair and for its reason:
     * this surface never unmounts, and its own invalidation comes back while
     * somebody may be typing in the other box.
     */
    values: toFormValues(organization),
    resetOptions: { keepDirtyValues: true },
    disabled: updateOrganization.isPending,
  });

  const isPending = updateOrganization.isPending;
  /*
   * A personal organization's slug is derived from the account's id and is what
   * proves there is exactly one of them (ADR-0067 §2 as amended). The service
   * refuses the edit; the form does not offer it, so the refusal is a rule a
   * customer never has to discover by being told no.
   */
  const editableSlug = organization.kind !== "personal";

  const onSubmit = async (values: UpdateOrganizationBody) => {
    const body = dirtyValuesOf(values, form.formState.dirtyFields);

    // Unreachable through the disabled button; kept because implicit submission
    // from a text field is not consistently blocked by it.
    if (Object.keys(body).length === 0) return;

    try {
      const updated = await updateOrganization.mutateAsync(body);

      form.reset(toFormValues(updated));

      if (updated.slug !== organization.slug)
        await navigate({
          params: { orgSlug: updated.slug },
          replace: true,
          to: "/orgs/$orgSlug/settings",
        });
    } catch (error) {
      applyServerErrors(error, form.setError, {
        codeFields: ORGANIZATION_ERROR_FIELDS,
        fields: FIELD_NAMES,
        messageForError,
        rules: schemaFieldRules(updateOrganizationBody, form.getValues()),
      });
    }
  };

  return (
    <AppFormProvider fields={organizationFields} form={form} variant="edit">
      {/* `noValidate`: the contracts schema through `zodResolver` is the
          validation, and the browser's bubbles would answer a different
          question in a different voice (ADR-0035). */}
      <form
        noValidate
        onSubmit={(event) => {
          void form.handleSubmit(onSubmit)(event);
        }}
      >
        <FieldSet aria-busy={isPending} disabled={isPending}>
          <FieldGroup>
            <OrganizationFormInput fieldName="name" />
            {editableSlug ? (
              <OrganizationFormInput fieldName="slug" />
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("details.personalNote")}
              </p>
            )}
            <AppFormError />
          </FieldGroup>

          <div className="mt-6 flex justify-end">
            <Button disabled={!form.formState.isDirty} type="submit">
              {isPending ? <Spinner /> : null}
              {t("details.save")}
            </Button>
          </div>
        </FieldSet>
      </form>
    </AppFormProvider>
  );
};
