import { zodResolver } from "@hookform/resolvers/zod";
import { createUserBody, type CreateUserBody } from "@repo/contracts";
import { useForm, type Resolver } from "react-hook-form";

import {
  UserFormInput,
  useCreateUser,
  userResourceConfig,
} from "@/entities/user";
import { AppFormDialog } from "@/shared/form/app-form-dialog";
import { applyServerErrors } from "@/shared/form/server-errors";
import { fieldsForVariant, initialValuesFor } from "@/shared/resource/config";

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
 * Components whose empty value means "the operator chose nothing".
 *
 * A `select` showing its placeholder has not been answered; an empty text box
 * has been answered with an empty string. Keeping that distinction is what lets
 * a blank **required** field still fail with its own schema's message
 * (`emailSchema` says what a bad address is) instead of zod's generic
 * complaint about a missing key.
 */
const UNCHOSEN_WHEN_EMPTY = new Set(["select", "multiCheckbox"]);

/** Which create fields report emptiness as "no answer" rather than as a value. */
const OPTIONAL_WHEN_EMPTY = new Set(
  CREATE_FIELDS.filter(([, field]) =>
    UNCHOSEN_WHEN_EMPTY.has(field.component),
  ).map(([name]) => name),
);

/**
 * The form's state as the request body.
 *
 * Two conversions, both of which are the config speaking: a `nullable` field's
 * empty control produced `null`, which on *create* means "not provided"; and an
 * unanswered `select` produced `""`. Everything else travels as typed.
 */
const asCreateBody = (values: Record<string, unknown>): CreateUserBody =>
  Object.fromEntries(
    Object.entries(values).filter(
      ([name, value]) =>
        value !== null && !(value === "" && OPTIONAL_WHEN_EMPTY.has(name)),
    ),
  ) as CreateUserBody;

const parseCreateBody = zodResolver(createUserBody);

/**
 * Validates the body rather than the form state (see the note above).
 *
 * The values it returns are what `handleSubmit` hands the submit callback, so
 * there is one conversion and no second place for the two to disagree.
 */
const resolver: Resolver<CreateUserBody> = (values, context, options) =>
  parseCreateBody(asCreateBody(values) as CreateUserBody, context, options);

export const CreateUserDialog = ({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}) => {
  const createUser = useCreateUser();

  const form = useForm<CreateUserBody>({
    resolver,
    defaultValues: initialValuesFor(
      userResourceConfig.fields,
      "create",
    ) as unknown as CreateUserBody,
    // The submit lock, half one (ADR-0035).
    disabled: createUser.isPending,
  });

  // Already the request body: the resolver converted and parsed it, so nothing
  // is left to prune here.
  const onSubmit = async (body: CreateUserBody) => {
    try {
      await createUser.mutateAsync(body);
      form.reset();
      onClose();
    } catch (error) {
      applyServerErrors(error, form.setError, {
        // This variant's names, never the resource's whole map: a detail naming
        // a field the form does not render would otherwise be set on a control
        // that is not on screen and suppress the form-level fallback.
        fields: FIELD_NAMES,
        codeFields: userResourceConfig.errorFields,
      });
    }
  };

  return (
    <AppFormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="New user"
      description="They can sign in as soon as this is saved."
      form={form}
      fields={userResourceConfig.fields}
      variant="create"
      onSubmit={onSubmit}
      isPending={createUser.isPending}
      submitLabel="Create"
    >
      <UserFormInput fieldName="email" />
      <UserFormInput fieldName="password" />
      <div className="grid gap-4 sm:grid-cols-2">
        <UserFormInput fieldName="firstName" />
        <UserFormInput fieldName="lastName" />
      </div>
      <UserFormInput fieldName="status" />
    </AppFormDialog>
  );
};
