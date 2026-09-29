import { zodResolver } from "@hookform/resolvers/zod";
import type { ErrorMessage } from "@repo/api-client";
import {
  AppFormError,
  AppFormProvider,
  applyServerErrors,
  schemaFieldRules,
} from "@repo/form";
import { useT } from "@repo/i18n";
import {
  dirtyValuesOf,
  fieldsForVariant,
  type FieldConfigMap,
} from "@repo/resource";
import { Button } from "@repo/ui/components/button";
import { FieldGroup, FieldSet } from "@repo/ui/components/field";
import { Spinner } from "@repo/ui/components/spinner";
import type { ComponentType } from "react";
import { useForm, type Resolver } from "react-hook-form";
import type { ZodType } from "zod";

/**
 * The two names, as either population's body spells them.
 *
 * A staff member's are `NOT NULL` and a customer's are nullable (ADR-0017), so
 * the contracts declare two bodies. What this form does with them is the same
 * — two text boxes, pruned to what changed — so it is written once over the
 * shape both bodies fit, and the app's own schema is what decides which
 * values are acceptable.
 */
export type ProfileNames = {
  firstName?: string | null | undefined;
  lastName?: string | null | undefined;
};

/** Nothing else changed: the default for an app that passes no `useAfterSave`. */
const useNothingAfter = (): (() => void) => nothing;
const nothing = (): void => undefined;

export interface ProfileDetailsDeps<TProfile, TBody extends ProfileNames> {
  /** The contract the endpoint validates with, on the app's own segment. */
  readonly schema: ZodType<TBody>;
  /** The profile entity's field map — the config decides what a field is. */
  readonly fields: FieldConfigMap;
  /** The entity's typed input over that map (ADR-0035). */
  readonly FormInput: ComponentType<{
    readonly fieldName: "firstName" | "lastName";
  }>;
  /** The account as this form's values. */
  readonly toFormValues: (profile: TProfile) => TBody;
  /** The app's own profile entity's mutation. */
  readonly useUpdateProfile: () => {
    readonly mutateAsync: (body: Partial<TBody>) => Promise<TProfile>;
    readonly isPending: boolean;
  };
  /** The app's code map over its own `errors` catalogue (ADR-0034). */
  readonly useMessageForError: () => ErrorMessage;
  /**
   * What else this write made stale, where an app has such a thing: in the
   * admin the names on the operator's own `/admin/staff` row are the ones
   * that just changed.
   */
  readonly useAfterSave?: (() => () => void) | undefined;
}

/**
 * `PATCH /<segment>/profile` — a person's own names (ADR-0027) — one form for
 * both apps since `D22.2` (ADR-0077 §2).
 *
 * **An inline form rather than a dialog, and therefore the one place that
 * assembles the frame by hand.** `AppFormDialog` owns the chrome every
 * *dialog* form repeats — the two providers, the `FieldSet disabled
 * aria-busy` half of the submit lock, `AppFormError`, and a dialog that cannot
 * be dismissed mid-flight — and everything on that list except the dialog
 * itself is repeated here, in about fifteen lines. The admin's copy carried a
 * note that a second inline form should promote a frame into the form
 * machinery; the customer's copy was the same form on the other segment and
 * not that second form, and the note stands.
 *
 * What is *not* hand-rolled is anything that decides what a field is: the
 * fields come from the entity's config, the controls from the registry, the
 * validation from the contract schema. This form knows only where they go,
 * which is exactly the line ADR-0035 draws.
 */
export const createProfileDetailsForm = <TProfile, TBody extends ProfileNames>({
  schema,
  fields,
  FormInput,
  toFormValues,
  useUpdateProfile,
  useMessageForError,
  useAfterSave = useNothingAfter,
}: ProfileDetailsDeps<TProfile, TBody>) => {
  /** What this form renders — the config decides, not this file. */
  const fieldNames = fieldsForVariant(fields, "edit").map(([name]) => name);

  /*
   * The one cast the generic costs. The resolver is built from the app's own
   * schema, whose body is `TBody`; the form's values are held as the shape
   * every such body fits, because react-hook-form's path types do not reduce
   * over an unresolved type parameter. Every `TBody` is a `ProfileNames` by
   * the constraint above, so what the resolver is handed and what it answers
   * with are both inside the type it is asserted to.
   */
  const resolver = zodResolver(
    schema as ZodType<ProfileNames, ProfileNames>,
  ) as Resolver<ProfileNames>;

  const ProfileDetailsForm = ({ profile }: { readonly profile: TProfile }) => {
    const { t } = useT("accountClient");
    const updateProfile = useUpdateProfile();
    const messageForError = useMessageForError();
    const afterSave = useAfterSave();

    const form = useForm<ProfileNames>({
      resolver,
      defaultValues: toFormValues(profile),
      /*
       * `values` + `keepDirtyValues`: a refetch that lands while somebody is
       * typing corrects the untouched fields and leaves the touched ones
       * alone. Here the refetch is this form's own invalidation coming back,
       * which is what makes the pair matter on a surface that never unmounts.
       */
      values: toFormValues(profile),
      resetOptions: { keepDirtyValues: true },
      disabled: updateProfile.isPending,
    });

    const isPending = updateProfile.isPending;

    const onSubmit = async (values: ProfileNames) => {
      /*
       * Pruned to what actually changed, so the contract's "provide at least
       * one field" refinement measures a real edit (ADR-0035) — and so
       * correcting one name does not re-send the other.
       */
      const body = dirtyValuesOf(
        values,
        form.formState.dirtyFields,
      ) as Partial<TBody>;

      // Unreachable through the disabled button, kept because implicit
      // submission from a text field is not consistently blocked by it.
      if (Object.keys(body).length === 0) return;

      try {
        const updated = await updateProfile.mutateAsync(body);

        afterSave();

        // Makes the just-saved values the new baseline, so the form is clean
        // and the button disables itself again. Without it `keepDirtyValues`
        // would hold these fields dirty against every later refetch.
        form.reset(toFormValues(updated));
      } catch (error) {
        applyServerErrors(error, form.setError, {
          fields: fieldNames,
          messageForError,
          /*
           * The same schema, caught a second time and in the reader's
           * language (`D7.5`, ADR-0046 §6). A detail whose path this form
           * renders is answered by the schema the form validates with rather
           * than echoed from the wire, because the wire's English is the
           * API's and not necessarily the reader's.
           */
          rules: schemaFieldRules(schema, form.getValues()),
        });
      }
    };

    return (
      <AppFormProvider fields={fields} variant="edit" form={form}>
        {/* `noValidate`: the contracts schema through `zodResolver` is the
            validation, and the browser's own bubbles would answer a different
            question in a different voice (ADR-0035). */}
        <form
          noValidate
          onSubmit={(event) => {
            void form.handleSubmit(onSubmit)(event);
          }}
        >
          <FieldSet disabled={isPending} aria-busy={isPending}>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormInput fieldName="firstName" />
                <FormInput fieldName="lastName" />
              </div>
              <AppFormError />
            </FieldGroup>

            <div className="mt-6 flex justify-end">
              <Button type="submit" disabled={!form.formState.isDirty}>
                {isPending ? <Spinner /> : null}
                {t("profile.save")}
              </Button>
            </div>
          </FieldSet>
        </form>
      </AppFormProvider>
    );
  };

  return ProfileDetailsForm;
};
