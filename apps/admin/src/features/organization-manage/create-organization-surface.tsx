import { zodResolver } from "@hookform/resolvers/zod";
import {
  createOrganizationAdminBody,
  type CreateOrganizationAdminBody,
} from "@repo/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";

import {
  OrganizationFormInput,
  organizationResourceConfig,
  useCreateOrganization,
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
  editSurfaceOf,
  fieldsForVariant,
  initialValuesFor,
} from "@/shared/resource/config";

/**
 * `POST /organizations` — composing a record (ADR-0040).
 *
 * The whole form is the resource's config: which fields exist, what they are
 * labelled, which control each one is and what it starts as were all declared
 * once in `entities/organization`. What this file contributes is *where*
 * they go and what happens on submit — the line ADR-0035 draws, and the reason
 * config never grows a `layout` key.
 *
 * Validation is `createOrganizationAdminBody`, the object the API validates
 * with (ADR-0011/0023), so a rule tightened in `@repo/contracts` tightens this
 * form in the same commit and there is no second copy to drift.
 *
 * **It is mounted by a route, not by a page's state**: `/organizations/new`
 * is what opens it, Back is what closes it, and a reload lands back here rather
 * than on a bare list. So there is no `open` prop and no `onClose` to thread.
 */

/** What the create form puts on screen — the config decides, not this file. */
const FIELD_NAMES = fieldsForVariant(
  organizationResourceConfig.fields,
  "create",
).map(([name]) => name);

export const CreateOrganizationSurface = () => {
  const { t } = useT("organizations");
  const navigate = useNavigate();
  const { closeSearch } = useRecordNavigation();
  const createOrganization = useCreateOrganization();
  const messageForError = useMessageForError();

  /*
   * The way back is history state, not the URL (ADR-0044): this record carries
   * no list params, so the view the operator left comes from the navigation
   * that opened it. A record reached by somebody else's link carries none, and
   * closes to the bare list — which is honest, because the recipient never had
   * the sender's view.
   */
  const close = () => {
    void navigate({ to: "/organizations", search: closeSearch });
  };

  const form = useForm<CreateOrganizationAdminBody>({
    resolver: zodResolver(createOrganizationAdminBody),
    /*
     * `initialValuesFor` reads the config's `initialValue`s, so every control
     * starts at a value rather than `undefined` — which is what stops React
     * taking them as uncontrolled on the first render and warning the moment
     * the operator types.
     */
    defaultValues: initialValuesFor(
      organizationResourceConfig.fields,
      "create",
    ) as unknown as CreateOrganizationAdminBody,
    // The submit lock, half one (ADR-0035): RHF disables every registered field.
    disabled: createOrganization.isPending,
  });

  const onSubmit = async (values: CreateOrganizationAdminBody) => {
    try {
      await createOrganization.mutateAsync(values);
      form.reset();
      close();
    } catch (error) {
      /*
       * `fields` is **this variant's** names, not the resource's whole map:
       * `applyServerErrors` reads the list as "fields this form renders", and
       * that is what makes its guarantee true — a detail it cannot place falls
       * through to `root.server` and is shown rather than set on a control that
       * is not on screen.
       */
      applyServerErrors(error, form.setError, {
        fields: FIELD_NAMES,
        codeFields: organizationResourceConfig.errorFields,
        messageForError,
        /*
         * The same schema, caught a second time and in this operator's
         * language (ADR-0046 §6): a detail whose path this form renders is
         * answered by the schema the form validates with rather than echoed
         * from the wire, because the wire's English is the API's and not
         * necessarily the operator's.
         */
        rules: schemaFieldRules(createOrganizationAdminBody, form.getValues()),
      });
    }
  };

  return (
    <AppFormSurface
      surface={editSurfaceOf(organizationResourceConfig)}
      onClose={close}
      title={t("create.title")}
      description={t("create.description")}
      form={form}
      fields={organizationResourceConfig.fields}
      variant="create"
      onSubmit={onSubmit}
      isPending={createOrganization.isPending}
      submitLabel={t("create.submit")}
    >
      <OrganizationFormInput fieldName="name" />
      <OrganizationFormInput fieldName="slug" />
      {/*
        The one control the edit surface does not have, and the asymmetry is
        ADR-0067 §3: staff are never members, so an organization staff create
        needs an owner named, and it cannot be the operator. Ownership moves
        afterwards through the members section, not through this form.
      */}
      <OrganizationFormInput fieldName="ownerId" />
    </AppFormSurface>
  );
};
