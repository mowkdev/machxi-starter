import { z } from "zod";

import { STAFF_ROLES, STAFF_STATUSES } from "../enums.js";
import { listQuerySchema } from "../list-query.js";
import { customRule } from "../locales/source.js";
import {
  emailSchema,
  idSchema,
  nameSchema,
  passwordSchema,
} from "../primitives.js";

/**
 * Request schemas for the staff module — `/api/v1/admin/staff` (ADR-0015),
 * reachable by `admin` and `super_admin` only (ADR-0019).
 */

/** `:id` of any single-staff route, including `/:id/sessions/revoke`. */
export const staffIdParams = z.strictObject({ id: idSchema });
export type StaffIdParams = z.infer<typeof staffIdParams>;

/**
 * The roles held by a staff member. At least one is required — a staff account
 * with no role can sign in but do nothing, which is a support ticket, not a
 * state worth modelling.
 *
 * The schema accepts `super_admin`; whether the *caller* may grant it is a
 * privilege question the service answers with `ctx.principal` (ADR-0019), not
 * something validation can decide.
 */
export const staffRolesSchema = z
  .array(z.enum(STAFF_ROLES))
  .min(1)
  .max(STAFF_ROLES.length)
  .refine(
    (roles) => new Set(roles).size === roles.length,
    customRule("rolesUnique"),
  );

/**
 * `POST /api/v1/admin/staff` — an admin creates a staff member with an initial
 * password; the account starts `active` (ADR-0018 §Staff onboarding). Names are
 * required because the `staff` table has them `NOT NULL` (ADR-0017).
 */
export const createStaffBody = z.strictObject({
  email: emailSchema,
  password: passwordSchema,
  firstName: nameSchema,
  lastName: nameSchema,
  roles: staffRolesSchema,
});
export type CreateStaffBody = z.infer<typeof createStaffBody>;

/**
 * `PATCH /api/v1/admin/staff/:id` — profile, roles and status (see the endpoint
 * scope in `docs/plan/0001-api-foundation.md`). Email is absent by design: changing
 * the identifier a session was established with is its own flow, not a field
 * edit. Refusing to disable or demote the last `super_admin` is an invariant of
 * the service, not of the schema (ADR-0017).
 */
export const updateStaffBody = z
  .strictObject({
    firstName: nameSchema.optional(),
    lastName: nameSchema.optional(),
    roles: staffRolesSchema.optional(),
    status: z.enum(STAFF_STATUSES).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, customRule("updateNotEmpty"));
export type UpdateStaffBody = z.infer<typeof updateStaffBody>;

/**
 * `PATCH /api/v1/admin/profile` — what a staff member may change about
 * themselves (ADR-0027).
 *
 * Names only, and the omissions are the decision: `roles` is absent so an
 * `editor` cannot promote itself past the guard that keeps it out of
 * `/admin/staff`, `status` is absent so a disabled operator cannot re-enable
 * itself inside its access token's remaining life, and `email` is absent for
 * the reason {@link updateStaffBody} omits it. There is no field to reject at
 * runtime because there is no field.
 *
 * Unlike the user profile's, the names are not nullable: the `staff` columns
 * are `NOT NULL` (ADR-0017), so "clear it" is not a legal request here.
 */
export const updateStaffProfileBody = z
  .strictObject({
    firstName: nameSchema.optional(),
    lastName: nameSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, customRule("updateNotEmpty"));
export type UpdateStaffProfileBody = z.infer<typeof updateStaffProfileBody>;

/**
 * `GET /api/v1/admin/staff` (ADR-0014).
 *
 * Roles are not filterable in v1: `staff_roles` is a join table, and every
 * other entry here resolves to a column on `staff` that an index can serve.
 * `q` searches email and name.
 */
export const listStaffQuery = listQuerySchema({
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
    status: { ops: ["eq", "in"], value: z.enum(STAFF_STATUSES) },
    email: { ops: ["eq", "like"], value: emailSchema },
    createdAt: { ops: ["gt", "gte", "lt", "lte"], value: z.coerce.date() },
    lastLoginAt: {
      ops: ["gt", "gte", "lt", "lte", "null"],
      value: z.coerce.date(),
    },
  },
  defaultSort: "-createdAt",
  searchable: true,
});
export type ListStaffQuery = z.infer<typeof listStaffQuery>;
