import { z } from "zod";

import { USER_ROLES, USER_STATUSES } from "../enums.js";
import { listQuerySchema } from "../list-query.js";
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
  .refine((roles) => new Set(roles).size === roles.length, {
    error: "Roles must not repeat",
  });

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
  .refine((body) => Object.keys(body).length > 0, {
    error: "Provide at least one field to update",
  });
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
  .refine((body) => Object.keys(body).length > 0, {
    error: "Provide at least one field to update",
  });
export type UpdateProfileBody = z.infer<typeof updateProfileBody>;

/**
 * `POST /api/v1/user/profile/change-password` — revokes the user's other
 * sessions on success (see the endpoint scope in `docs/plan/0001-api-foundation.md`).
 *
 * `currentPassword` is only bounded, not held to the policy: it is a
 * credential being verified, and an account whose password predates a policy
 * change must still be able to change it.
 */
export const changePasswordBody = z
  .strictObject({
    currentPassword: presentedPasswordSchema,
    newPassword: passwordSchema,
  })
  .refine((body) => body.newPassword !== body.currentPassword, {
    path: ["newPassword"],
    error: "The new password must differ from the current one",
  });
export type ChangePasswordBody = z.infer<typeof changePasswordBody>;

/**
 * `GET /api/v1/admin/users` (ADR-0014). `q` searches email and name.
 * `deletedAt` is filterable by presence only: the timestamp itself is an
 * internal soft-delete marker, but "show me deleted accounts" is a real admin
 * question (ADR-0017).
 */
export const listUsersQuery = listQuerySchema({
  sortable: [
    "createdAt",
    "updatedAt",
    "email",
    "firstName",
    "lastName",
    "status",
    "lastLoginAt",
  ],
  filterable: {
    status: { ops: ["eq", "in"], value: z.enum(USER_STATUSES) },
    email: { ops: ["eq", "like"], value: emailSchema },
    createdAt: { ops: ["gt", "gte", "lt", "lte"], value: z.coerce.date() },
    lastLoginAt: {
      ops: ["gt", "gte", "lt", "lte", "null"],
      value: z.coerce.date(),
    },
    deletedAt: { ops: ["null"] },
  },
  defaultSort: "-createdAt",
  searchable: true,
});
export type ListUsersQuery = z.infer<typeof listUsersQuery>;
