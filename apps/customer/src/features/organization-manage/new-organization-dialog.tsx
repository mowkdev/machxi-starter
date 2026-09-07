import { zodResolver } from "@hookform/resolvers/zod";
import {
  createOrganizationBody,
  type CreateOrganizationBody,
} from "@repo/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";

import {
  OrganizationFormInput,
  organizationFields,
  useCreateOrganization,
} from "@/entities/organization";
import { AppFormDialog } from "@/shared/form/app-form-dialog";
import {
  applyServerErrors,
  schemaFieldRules,
} from "@/shared/form/server-errors";
import { useT } from "@/shared/i18n";
import { useMessageForError } from "@/shared/notifications/messages";

/**
 * `POST /user/orgs` — a `team` organization with the caller as its owner
 * (ADR-0067 §2, §6 as amended 2026-09-07).
 *
 * **A dialog opened from the switcher's menu, and it was a card on a settings
 * screen until `D15.9`.** The amendment moved it for the reason it moved the
 * settings themselves: "new organization" is not about the organization whose
 * screen you happen to be standing on, and a card on another tenant's settings
 * page is an action filed under the wrong subject. The switcher's menu is where
 * a customer already goes to change which organization they are in, so it is
 * where they go to make one — the account menu's own shape (ADR-0053 §2), which
 * carries the way into the account area beside the way out of the session.
 *
 * **It is a dialog and not a menu entry that writes.** The menu decides where
 * you stand; this asks for two fields and posts them. Opening a dialog *from* a
 * menu keeps that division intact — the entry navigates nowhere and the write
 * happens on a surface of its own.
 *
 * `kind` is absent from the body by construction: exactly one `personal`
 * organization exists per account and the system creates it, so there is no
 * value of the field a customer could legally send.
 *
 * **It navigates into what it made.** Creating an organization one then has to
 * go and find is a surface that stopped short of the thing it was for; the
 * switcher's list is invalidated by the entity hook, and this decides where the
 * customer stands next — the ADR-0049 boundary that keeps routing out of the
 * entity layer.
 */
export const NewOrganizationDialog = ({
  onClose,
}: {
  readonly onClose: () => void;
}) => {
  const { t } = useT("organizations");
  const navigate = useNavigate();
  const createOrganization = useCreateOrganization();
  const messageForError = useMessageForError();

  const form = useForm<CreateOrganizationBody>({
    resolver: zodResolver(createOrganizationBody),
    defaultValues: { name: "", slug: "" },
    disabled: createOrganization.isPending,
  });

  const onSubmit = async (values: CreateOrganizationBody) => {
    try {
      const created = await createOrganization.mutateAsync(values);

      form.reset();
      onClose();
      await navigate({
        params: { orgSlug: created.slug },
        to: "/orgs/$orgSlug",
      });
    } catch (error) {
      applyServerErrors(error, form.setError, {
        // A taken address is a `409` with no `details`, and the box to change
        // is the address.
        codeFields: { CONFLICT: "slug" },
        fields: Object.keys(organizationFields),
        messageForError,
        rules: schemaFieldRules(createOrganizationBody, form.getValues()),
      });
    }
  };

  return (
    <AppFormDialog
      description={t("create.description")}
      fields={organizationFields}
      form={form}
      isPending={createOrganization.isPending}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      onSubmit={onSubmit}
      open
      submitLabel={t("create.submit")}
      title={t("create.title")}
      variant="create"
    >
      <OrganizationFormInput fieldName="name" />
      <OrganizationFormInput fieldName="slug" />
    </AppFormDialog>
  );
};
