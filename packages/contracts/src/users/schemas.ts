import { z } from "zod";

import { USER_ROLES, USER_STATUSES } from "../enums.js";
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
