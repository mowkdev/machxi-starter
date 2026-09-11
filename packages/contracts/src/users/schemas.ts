import { z } from "zod";

import { FEDERATED_PROVIDERS, USER_ROLES, USER_STATUSES } from "../enums.js";
import { listQuerySchema, type FilterSpec } from "../list-query.js";
import { customRule } from "../locales/source.js";
import {
  emailSchema,
  idSchema,
  nameSchema,
  passwordSchema,
  presentedPasswordSchema,
} from "../primitives.js";

/**
 * Request schemas for the users module. One module serves two segments
 * (ADR-0009): `/api/v1/admin/users` for staff administration and
 * `/api/v1/user/profile` for a user acting on their own account.
 *
 * The two credential bodies these segments use — `changePasswordBody` and
 * `setPasswordBody` — live in `auth/` and are re-exported by this module's
 * barrel: both populations send the identical shapes, so ADR-0023 has them
 * declared once (ADR-0027 §Contracts).
 */

/** `:id` of any single-user admin route, including `/:id/sessions/revoke`. */
export const userIdParams = z.strictObject({ id: idSchema });
export type UserIdParams = z.infer<typeof userIdParams>;

/**
 * The roles held by a user. v1 has exactly one role, so this is optional on
 * create and the service defaults it to `customer` (ADR-0017).
 */
export const userRolesSchema = z
  .array(z.enum(USER_ROLES))
  .min(1)
  .max(USER_ROLES.length)
  .refine(
    (roles) => new Set(roles).size === roles.length,
    customRule("rolesUnique"),
  );

/**
 * `POST /api/v1/admin/users` — a staff member creates a user account directly,
 * with an initial password. Self-registration goes through `registerBody`
 * instead (ADR-0018); names stay optional in both because the `users` table
 * allows them to be null (ADR-0017).
 */
export const createUserBody = z.strictObject({
  email: emailSchema,
  password: passwordSchema,
  firstName: nameSchema.optional(),
  lastName: nameSchema.optional(),
  status: z.enum(USER_STATUSES).optional(),
  roles: userRolesSchema.optional(),
});
export type CreateUserBody = z.infer<typeof createUserBody>;

/**
 * `PATCH /api/v1/admin/users/:id`. Names accept `null` to clear them, which
 * `undefined` cannot express in a partial update — the column is nullable, so
 * "unset it" is a legal request and must be distinguishable from "leave it".
 */
export const updateUserBody = z
  .strictObject({
    firstName: nameSchema.nullable().optional(),
    lastName: nameSchema.nullable().optional(),
    status: z.enum(USER_STATUSES).optional(),
    roles: userRolesSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, customRule("updateNotEmpty"));
export type UpdateUserBody = z.infer<typeof updateUserBody>;

/**
 * `PATCH /api/v1/user/profile` — what a user may change about themselves.
 * Status and roles are absent by construction: a user cannot promote or
 * re-enable their own account by editing their profile.
 */
export const updateProfileBody = z
  .strictObject({
    firstName: nameSchema.nullable().optional(),
    lastName: nameSchema.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, customRule("updateNotEmpty"));
export type UpdateProfileBody = z.infer<typeof updateProfileBody>;

/**
 * `DELETE /api/v1/user/profile` — an account deleting itself (ADR-0055 §4).
 *
 * It has a body, which a `DELETE` is not obliged to have, because the actor
 * must re-authenticate: a session is not an identity proof for an irreversible
 * act, and this is the one operation more destructive than a password change
 * (ADR-0027's principle, applied by ADR-0055).
 *
 * Declared here rather than beside `changePasswordBody` in `auth/`, which is
 * where shapes *both* populations send live: only `users` self-delete.
 * ADR-0028 rule 4 refuses staff self-deletion outright, so there is no second
 * consumer for this shape to be shared with, and no staff mirror will appear.
 *
 * `presentedPasswordSchema`, not `passwordSchema`: the value is a credential
 * being verified, and an account whose password predates a policy change must
 * still be able to close itself.
 */
export const deleteProfileBody = z.strictObject({
  currentPassword: presentedPasswordSchema,
});
export type DeleteProfileBody = z.infer<typeof deleteProfileBody>;

/**
 * `POST /api/v1/user/profile/change-email` — an account asking to move to a
 * new address (ADR-0071 §6).
 *
 * **Nothing here changes an address.** The endpoint mails a confirmation link
 * to `newEmail` and answers `202`; the address moves only when that link is
 * followed, which is what makes the request safe to accept from a caller who
 * has typed a mailbox they may not own.
 *
 * `currentPassword` is required for the reason ADR-0027 requires it on a
 * password change, and with more force: a changed address redirects every
 * future recovery link, so an access token that could move it would be worth
 * the account. It is `presentedPasswordSchema` rather than `passwordSchema` —
 * the value is a credential being verified, and an account whose password
 * predates a policy change must still be able to change its address.
 *
 * Declared here rather than beside the credential shapes in `auth/` for
 * {@link deleteProfileBody}'s reason: only `users` change their own address.
 * A staff member's is set by a super admin (ADR-0071 §7), which is a
 * different body on a different segment with a different subject.
 *
 * **No `locale`**, where the anonymous senders carry one: this caller is an
 * account, and an account's locale is a stored fact the server reads for
 * itself (ADR-0046, ADR-0071 §2). A field here would be a client telling the
 * server what language its own row says.
 */
export const changeEmailBody = z.strictObject({
  newEmail: emailSchema,
  currentPassword: presentedPasswordSchema,
});
export type ChangeEmailBody = z.infer<typeof changeEmailBody>;

/**
 * `DELETE /api/v1/user/profile/identities/:provider` — which external
 * identity the account is unlinking (ADR-0072 §3).
 *
 * `FEDERATED_PROVIDERS` and nothing else, so an unknown provider is a `400`
 * from the schema rather than a `404` the service has to reason about.
 */
export const identityProviderParams = z.strictObject({
  provider: z.enum(FEDERATED_PROVIDERS),
});
export type IdentityProviderParams = z.infer<typeof identityProviderParams>;

/**
 * The body of that `DELETE` — the current password, for ADR-0027's rule
 * wherever a credential is removed (ADR-0072 §3): severing the owner's own way
 * back in is takeover-adjacent, so a session alone is not enough.
 *
 * A body on a `DELETE` for {@link deleteProfileBody}'s reason, and
 * `presentedPasswordSchema` for its reason too.
 */
export const unlinkIdentityBody = z.strictObject({
  currentPassword: presentedPasswordSchema,
});
export type UnlinkIdentityBody = z.infer<typeof unlinkIdentityBody>;

/**
 * `GET /api/v1/admin/users` (ADR-0014). `q` searches email and name.
 * `deletedAt` is filterable by presence only: the timestamp itself is an
 * internal soft-delete marker, but "show me deleted accounts" is a real admin
 * question (ADR-0017).
 */
/**
 * The sortable allow-list, named so the module's index test can read it
 * (ADR-0060 §3).
 *
 * `listQuerySchema` swallows its options into a parser, and the rule "a column
 * enters an allow-list only with its index in the same step" needs the list
 * back out to be checked against the schema's index declarations. Exported as
 * a `const` tuple rather than restated in the test, so the thing asserted is
 * the thing the endpoint enforces.
 */
export const LIST_USERS_SORTABLE = [
  "createdAt",
  "updatedAt",
  "email",
  "firstName",
  "lastName",
  "status",
  "lastLoginAt",
] as const;

/** The filterable allow-list, exported for the same reason. */
export const LIST_USERS_FILTERABLE = {
  status: { ops: ["eq", "in"], value: z.enum(USER_STATUSES) },
  email: { ops: ["eq", "like"], value: emailSchema },
  createdAt: { ops: ["gt", "gte", "lt", "lte"], value: z.coerce.date() },
  lastLoginAt: {
    ops: ["gt", "gte", "lt", "lte", "null"],
    value: z.coerce.date(),
  },
  deletedAt: { ops: ["null"] },
} satisfies FilterSpec;

export const listUsersQuery = listQuerySchema({
  sortable: LIST_USERS_SORTABLE,
  filterable: LIST_USERS_FILTERABLE,
  defaultSort: "-createdAt",
  searchable: true,
});
export type ListUsersQuery = z.infer<typeof listUsersQuery>;
