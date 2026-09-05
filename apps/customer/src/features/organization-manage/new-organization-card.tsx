import { zodResolver } from "@hookform/resolvers/zod";
import {
  createOrganizationBody,
  type CreateOrganizationBody,
} from "@repo/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
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
import {
  Button,
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui";

/**
 * `POST /user/orgs` — a `team` organization with the caller as its owner
 * (ADR-0067 §2, §6).
 *
 * **A card on the settings screen rather than an entry in the switcher**, which
 * is where ADR-0067 §6 puts it: the switcher is navigation and this is a write,
 * and a menu that both moves you and creates things is a menu whose entries
 * mean two different kinds of thing. The path in is the switcher all the same —
 * any organization's settings screen carries this card, including the personal
 * one every account starts with, so a customer with no team yet has one click
 * to it.
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
const NewOrganizationDialog = ({
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

export const NewOrganizationCard = () => {
  const { t } = useT("organizations");
  const [creating, setCreating] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("create.title")}</CardTitle>
        <CardDescription>{t("create.description")}</CardDescription>
        <CardAction>
          <Button
            onClick={() => {
              setCreating(true);
            }}
            variant="outline"
          >
            {t("create.action")}
          </Button>
        </CardAction>
      </CardHeader>
      {/*
       * No `CardContent`, deliberately: the header already carries the title,
       * the sentence and the control, and an empty content region would draw
       * the card's padding under nothing. `ADR-0048 §3`'s rule for a slot with
       * no consumer, one component down.
       */}

      {creating ? (
        <NewOrganizationDialog
          onClose={() => {
            setCreating(false);
          }}
        />
      ) : null}
    </Card>
  );
};
