import { z } from "zod";

import { mailLocaleSchema } from "../auth/schemas.js";
import { STAFF_ROLES, STAFF_STATUSES } from "../enums.js";
import { listQuerySchema, type FilterSpec } from "../list-query.js";
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
 * `POST /api/v1/admin/staff` — an admin creates an operator, with an initial
 * password or with an invitation (ADR-0018 §Staff onboarding, ADR-0071 §8).
 * Names are required because the `staff` table has them `NOT NULL` (ADR-0017).
 *
 * **`password` is optional and the absence is the request**, not a field
 * somebody forgot: omitted, the row is created `invited` with a null hash and
 * an onboarding link is mailed; present, the account is `active` at once,
 * exactly as before ADR-0071. There is no `status` field to disagree with that
 * — which of the two happened is decided by whether a credential was supplied,
 * so the two facts cannot come apart.
 *
 * `locale` is ADR-0071 §2's seam and rides here for `registerBody`'s reason: an
 * invitation goes to a stranger, the row it names has no stored locale yet —
 * it is one request old and has never signed in — so the only language fact
 * available is the one the panel is being read in. Ignored when a password is
 * supplied, because then nothing is mailed.
 */
export const createStaffBody = z.strictObject({
  email: emailSchema,
  password: passwordSchema.optional(),
  firstName: nameSchema,
  lastName: nameSchema,
  roles: staffRolesSchema,
  locale: mailLocaleSchema,
});
export type CreateStaffBody = z.infer<typeof createStaffBody>;

/**
 * `POST /api/v1/admin/staff/:id/onboarding/resend` (ADR-0071 §8).
 *
 * A body of one optional field, and it is here rather than absent for
 * {@link createStaffBody}'s reason: the message is re-sent to the same
 * stranger, whose account still has no stored locale, so §2's seam is still
 * the only language fact there is.
 */
export const resendStaffOnboardingBody = z.strictObject({
  locale: mailLocaleSchema,
});
export type ResendStaffOnboardingBody = z.infer<
  typeof resendStaffOnboardingBody
>;

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
export const LIST_STAFF_SORTABLE = [
  "createdAt",
  "updatedAt",
  "email",
  "firstName",
  "lastName",
  "status",
  "lastLoginAt",
] as const;

/** The filterable allow-list, exported for the same reason. */
export const LIST_STAFF_FILTERABLE = {
  status: { ops: ["eq", "in"], value: z.enum(STAFF_STATUSES) },
  email: { ops: ["eq", "like"], value: emailSchema },
  createdAt: { ops: ["gt", "gte", "lt", "lte"], value: z.coerce.date() },
  lastLoginAt: {
    ops: ["gt", "gte", "lt", "lte", "null"],
    value: z.coerce.date(),
  },
} satisfies FilterSpec;

export const listStaffQuery = listQuerySchema({
  sortable: LIST_STAFF_SORTABLE,
  filterable: LIST_STAFF_FILTERABLE,
  defaultSort: "-createdAt",
  searchable: true,
});
export type ListStaffQuery = z.infer<typeof listStaffQuery>;
