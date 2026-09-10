import { zodResolver } from "@hookform/resolvers/zod";
import {
  createStaffBody,
  type CreateStaffBody,
  type Locale,
} from "@repo/contracts";
import { useNavigate } from "@tanstack/react-router";

import { useRecordNavigation } from "@/shared/grid/record-navigation";
import { useMemo } from "react";
import { useForm, type Resolver } from "react-hook-form";

import {
  StaffFormInput,
  staffResourceConfig,
  useCreateStaff,
} from "@/entities/staff";
import { AppFormSurface } from "@/shared/form/app-form-surface";
import { useLocale, useT } from "@/shared/i18n";
import {
  applyServerErrors,
  schemaFieldRules,
} from "@/shared/form/server-errors";
import { useMessageForError } from "@/shared/notifications/messages";
import {
  editSurfaceOf,
  fieldsForVariant,
  initialValuesFor,
} from "@/shared/resource/config";

/**
 * `POST /admin/staff` — an admin creates an operator, with an initial password
 * or with an invitation (ADR-0018 §Staff onboarding, ADR-0071 §8).
 *
 * The whole form is the resource's config: which fields exist, what they are
 * labelled, which control each one is and what it starts as were all declared
 * once in `entities/staff`. What this file contributes is *where* they go and
 * what happens on submit — the line ADR-0035 draws and the reason config never
 * grows a `layout` key.
 *
 * Validation is `createStaffBody`, the object the API validates with
 * (ADR-0011/0023), so a password rule tightened in `@repo/contracts` tightens
 * this form in the same commit and there is no second copy to drift.
 *
 * **The password box is optional and empty is the default**, which is the
 * whole of §8 on this screen: an untouched box means "mail them an invitation
 * and let them choose", and a typed one means the account this endpoint has
 * always made. There is no radio, no toggle and no second submit — the field
 * itself carries the choice, so there is no state that can disagree with what
 * was typed.
 *
 * **It is mounted by a route, not by a page's state** (`D4.2`, ADR-0040):
 * `/staff/new` is what opens it, Back is what closes it, and a reload lands
 * back here rather than on a bare list. So there is no `open` prop and no
 * `onClose` to thread — every dismissal is one navigation back to the list.
 */
/** What the create form puts on screen — the config decides, not this file. */
const FIELD_NAMES = fieldsForVariant(staffResourceConfig.fields, "create").map(
  ([name]) => name,
);

/**
 * The body as ADR-0071 §8 wants it read: an untouched password box is an
 * **omitted** field, not an empty one.
 *
 * The two are the same three keystrokes to an operator and entirely different
 * requests to the API — `""` fails the policy with a `400`, while absence is
 * "send them an invitation". The form seeds every text control with `""` so
 * React holds it from the first render (ADR-0035), so the translation has to
 * happen on the way out, once, here.
 *
 * The locale rides along on the same journey and for §2's reason: the invited
 * account has no stored one yet, so the language this panel is being read in
 * is the only fact there is. It is sent on both branches because the API
 * ignores it when a password was typed — a second condition here would be one
 * more thing to keep in step with the server.
 */
const withInvitationDefault = (
  values: CreateStaffBody,
  locale: Locale,
): CreateStaffBody => {
  const { password, ...rest } = values;

  return password === undefined || password === ""
    ? { ...rest, locale }
    : { ...rest, password, locale };
};

export const CreateStaffSurface = () => {
  const { t } = useT("staff");
  const { locale } = useLocale();
  const navigate = useNavigate();
  const { closeSearch } = useRecordNavigation();
  const createStaff = useCreateStaff();
  const messageForError = useMessageForError();

  /*
   * The way back is history state, not the URL (ADR-0044, `D5.3`): this record
   * carries no list params, so the view the operator left comes from the
   * navigation that opened it. A record reached by a link from somebody else
   * carries none, and closes to the bare list — which is honest, because the
   * recipient never had the sender's view.
   */
  const close = () => {
    void navigate({ to: "/staff", search: closeSearch });
  };

  /*
   * **The resolver validates the body that will be sent, not the one on
   * screen**, and that is what makes the empty box mean "invite them" rather
   * than "`400`". `zodResolver(createStaffBody)` alone would refuse the `""`
   * the field is seeded with — `passwordSchema` is `.min()`, and an empty
   * string is a short password rather than an absent one — so the form would
   * never submit at all on §8's happy path. Normalising first puts the two
   * halves in one place: what zod judges is what the API receives, so a
   * refusal here is a refusal there.
   */
  const resolver = useMemo<Resolver<CreateStaffBody>>(() => {
    const base = zodResolver(createStaffBody);

    return (values, context, options) =>
      base(withInvitationDefault(values, locale), context, options);
  }, [locale]);

  const form = useForm<CreateStaffBody>({
    resolver,
    /*
     * `initialValuesFor` reads the config's `initialValue`s, so `roles` starts
     * `["editor"]` and every text field starts `""` rather than `undefined` —
     * which is what stops React taking the controls as uncontrolled on the
     * first render and warning the moment the operator types.
     */
    defaultValues: initialValuesFor(
      staffResourceConfig.fields,
      "create",
    ) as unknown as CreateStaffBody,
    // The submit lock, half one (ADR-0035): RHF disables every registered field.
    disabled: createStaff.isPending,
  });

  const onSubmit = async (values: CreateStaffBody) => {
    try {
      await createStaff.mutateAsync(withInvitationDefault(values, locale));
      form.reset();
      close();
    } catch (error) {
      /*
       * `STAFF_EMAIL_TAKEN` is a `409` with no `details`, so without the code
       * map it would land at the top of the form when the answer is plainly the
       * email box. Everything the server *does* give a path for — a password
       * the policy rejects, a role that is not in the enum — lands on its own
       * field, and whatever matches nothing is still shown by `AppFormError`.
       */
      applyServerErrors(error, form.setError, {
        /*
         * This variant's field names, not the resource's whole map.
         *
         * `applyServerErrors` reads the list as "fields this form *renders*",
         * and that is what makes its guarantee true — a detail it cannot place
         * falls through to `root.server` and is shown. Handing it a name the
         * form does not render (`status`, which is edit-only) would make
         * `setError` land on a control that is not on screen, count as landed,
         * and skip the fallback: the submit fails and says why to nobody.
         */
        fields: FIELD_NAMES,
        codeFields: staffResourceConfig.errorFields,
        messageForError,
        /*
         * The same schema, caught a second time and in this operator's
         * language (`D7.5`, ADR-0046 §6). A detail whose path this form
         * renders is answered by the schema the form validates with rather
         * than echoed from the wire, because the wire's English is the API's
         * and not necessarily the operator's.
         */
        rules: schemaFieldRules(createStaffBody, form.getValues()),
      });
    }
  };

  return (
    <AppFormSurface
      surface={editSurfaceOf(staffResourceConfig)}
      onClose={close}
      title={t("create.title")}
      description={t("create.description")}
      form={form}
      fields={staffResourceConfig.fields}
      variant="create"
      onSubmit={onSubmit}
      isPending={createStaff.isPending}
      submitLabel={t("create.submit")}
    >
      <StaffFormInput fieldName="email" />
      <StaffFormInput fieldName="password" />
      <div className="grid gap-4 sm:grid-cols-2">
        <StaffFormInput fieldName="firstName" />
        <StaffFormInput fieldName="lastName" />
      </div>
      {/*
       * `status` is placed and does not render: it is `variants: ["edit"]` in
       * config, because `createStaffBody` takes no status — ADR-0018 creates
       * staff `active`. The config decides, not this JSX, which is what lets
       * one placement serve both forms.
       */}
      <StaffFormInput fieldName="status" />
      <StaffFormInput fieldName="roles" />
    </AppFormSurface>
  );
};
