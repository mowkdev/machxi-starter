import { zodResolver } from "@hookform/resolvers/zod";
import { createUserBody, type CreateUserBody } from "@repo/contracts";
import { useNavigate } from "@tanstack/react-router";

import { useRecordNavigation } from "@/shared/grid/record-navigation";
import { useForm, type Resolver, type ResolverOptions } from "react-hook-form";

import {
  UserFormInput,
  useCreateUser,
  userResourceConfig,
} from "@/entities/user";
import { AppFormSurface } from "@/shared/form/app-form-surface";
import { useT } from "@/shared/i18n";
import { applyServerErrors } from "@/shared/form/server-errors";
import { useMessageForError } from "@/shared/notifications/messages";
import {
  editSurfaceOf,
  fieldsForVariant,
  initialValuesFor,
} from "@/shared/resource/config";

/**
 * `POST /admin/users` — a staff member creates a customer account with an
 * initial password (`admin` only; a manager reads the customer base).
 *
 * **The one thing here that is not a copy of the staff dialog is what an empty
 * control means**, and it is worth the paragraph because it is the first place
 * the D3.6 machinery met a contract it could not express.
 *
 * `createStaffBody` has no optional fields, so a staff create form always sends
 * every key. `createUserBody` has four, and for each of them "the operator left
 * this blank" has to reach the API as an **absent key** — `""` is refused by
 * `nameSchema.trim().min(1)` and by `z.enum(USER_STATUSES)`, and `null` is
 * refused because only the *update* body is nullable. But an HTML control
 * cannot hold "absent"; the closest it has is `""` or, for a `nullable` field,
 * `null`.
 *
 * So the values RHF holds are not the body, and validating them was the bug —
 * a blank optional field failed the resolver on a request that would never have
 * been sent. {@link asCreateBody} converts the form's state into the request
 * *before* validation, and the resolver returns that converted object, so
 * `handleSubmit` receives exactly what goes on the wire. Client and server
 * validate the same body, which is the whole point of resolving against the
 * contract's own schema (ADR-0035).
 */

/** What the create form puts on screen — the config decides, not this file. */
const CREATE_FIELDS = fieldsForVariant(userResourceConfig.fields, "create");
const FIELD_NAMES = CREATE_FIELDS.map(([name]) => name);

/**
 * What the controls actually hold, which is **not** a `CreateUserBody`.
 *
 * Three of the five differ from the body's type — a nullable name rests at
 * `null`, an unanswered `select` at `""` — and typing the form as the body
 * would need a double cast that says exactly that and then hides it. Naming
 * the real shape is what lets `useForm`'s third type parameter carry the
 * transform: the state is this, `handleSubmit` receives a `CreateUserBody`, and
 * the conversion between them is `asCreateBody` rather than an assertion.
 */
type CreateUserFormValues = {
  email: string;
  password: string;
  firstName: string | null;
  lastName: string | null;
  status: string;
};

/**
 * Fields whose *empty* value means "the operator chose nothing".
 *
 * A `select` showing its placeholder has not been answered, and neither has a
 * `multiCheckbox` with nothing ticked; an empty text box **has** been answered,
 * with an empty string. Keeping that distinction is what lets a blank
 * **required** field still fail with its own schema's message (`emailSchema`
 * says what a bad address is) instead of zod's generic complaint about a
 * missing key.
 */
const UNCHOSEN_WHEN_EMPTY = new Set(["select", "multiCheckbox"]);

const OPTIONAL_WHEN_EMPTY = new Set(
  CREATE_FIELDS.filter(([, field]) =>
    UNCHOSEN_WHEN_EMPTY.has(field.component),
  ).map(([name]) => name),
);

/** Fields the config says may be cleared, and whose `null` therefore means it. */
const NULLABLE = new Set(
  CREATE_FIELDS.filter(([, field]) => field.nullable === true).map(
    ([name]) => name,
  ),
);

/**
 * Whether a control's value is the operator declining to answer.
 *
 * Both branches are the *config* speaking rather than this function guessing:
 * `nullable` is why an emptied name arrives as `null`, and `component` is what
 * makes an empty value mean "unchosen" rather than "chosen as empty". A
 * `multiCheckbox` holds `[]` rather than `""` when nothing is ticked, which is
 * why emptiness is tested per shape and not with a falsy check.
 */
const isUnanswered = (name: string, value: unknown): boolean => {
  if (value === null) return NULLABLE.has(name);
  if (!OPTIONAL_WHEN_EMPTY.has(name)) return false;

  return value === "" || (Array.isArray(value) && value.length === 0);
};

/**
 * The form's state as the request body: everything the operator answered, and
 * nothing they did not.
 */
export const asCreateBody = (values: Record<string, unknown>): CreateUserBody =>
  Object.fromEntries(
    Object.entries(values).filter(
      ([name, value]) => !isUnanswered(name, value),
    ),
  ) as CreateUserBody;

const parseCreateBody = zodResolver(createUserBody);

/**
 * Validates the body rather than the form state (see the note above).
 *
 * The values it returns are what `handleSubmit` hands the submit callback — RHF
 * uses the resolver's output when one is present — so there is exactly one
 * conversion and no second place for the two to disagree. That is also what the
 * three type parameters say: state in, body out.
 */
const resolver: Resolver<CreateUserFormValues, unknown, CreateUserBody> = (
  values,
  context,
  options,
) =>
  parseCreateBody(
    asCreateBody(values),
    context,
    /*
     * The one cast in this file, and it is on **metadata**, not on data.
     * `ResolverOptions` is generic over the form's value type only so that its
     * `names` and `fields` can be keyed by field name — and those names are
     * identical on both sides of the conversion, because the conversion drops
     * keys and never renames one. `zodResolver` reads nothing from it but
     * `criteriaMode` and `shouldUseNativeValidation`.
     *
     * Casting the *values* instead is what the first version of this file did
     * (`as unknown as CreateUserBody` on `defaultValues`), and it asserted away
     * precisely the difference the file exists to handle.
     */
    options as unknown as ResolverOptions<CreateUserBody>,
  );

export const CreateUserSurface = () => {
  const { t } = useT("users");
  const navigate = useNavigate();
  const { closeSearch } = useRecordNavigation();

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

  const createUser = useCreateUser();
  const messageForError = useMessageForError();

  const form = useForm<CreateUserFormValues, unknown, CreateUserBody>({
    resolver,
    defaultValues: initialValuesFor(
      userResourceConfig.fields,
      "create",
    ) as CreateUserFormValues,
    // The submit lock, half one (ADR-0035).
    disabled: createUser.isPending,
  });

  // Already the request body: the resolver converted and parsed it, so nothing
  // is left to prune here.
  const onSubmit = async (body: CreateUserBody) => {
    try {
      await createUser.mutateAsync(body);
      form.reset();
      close();
    } catch (error) {
      applyServerErrors(error, form.setError, {
        // This variant's names, never the resource's whole map: a detail naming
        // a field the form does not render would otherwise be set on a control
        // that is not on screen and suppress the form-level fallback.
        fields: FIELD_NAMES,
        codeFields: userResourceConfig.errorFields,
        messageForError,
      });
    }
  };

  return (
    <AppFormSurface
      surface={editSurfaceOf(userResourceConfig)}
      onClose={close}
      title={t("create.title")}
      description={t("create.description")}
      form={form}
      fields={userResourceConfig.fields}
      variant="create"
      onSubmit={onSubmit}
      isPending={createUser.isPending}
      submitLabel={t("create.submit")}
    >
      <UserFormInput fieldName="email" />
      <UserFormInput fieldName="password" />
      <div className="grid gap-4 sm:grid-cols-2">
        <UserFormInput fieldName="firstName" />
        <UserFormInput fieldName="lastName" />
      </div>
      <UserFormInput fieldName="status" />
    </AppFormSurface>
  );
};
