import {
  changePasswordBody,
  createStaffBody,
  listStaffQuery,
  resendStaffOnboardingBody,
  setEmailBody,
  setPasswordBody,
  staffIdParams,
  updateStaffBody,
  updateStaffProfileBody,
} from "@repo/contracts";

/**
 * The route schemas of the staff module (ADR-0011).
 *
 * Re-exported from `@repo/contracts` rather than declared here (ADR-0023): the
 * admin panel builds the same forms and the same list query against the same
 * objects, so a field the server rejects is a field the client never sends. A
 * server-only refinement — one a client could not evaluate — would be layered
 * on top of the imported schema, in this file.
 *
 * Grouped as `{ params?, query?, body? }` because that is what `validate()`
 * takes and what `ValidatedRequest<typeof schema>` reads to type `req.valid`.
 */

export const listStaffSchema = { query: listStaffQuery } as const;
export const getStaffSchema = { params: staffIdParams } as const;
export const createStaffSchema = { body: createStaffBody } as const;
export const updateStaffSchema = {
  params: staffIdParams,
  body: updateStaffBody,
} as const;
export const revokeStaffSessionsSchema = { params: staffIdParams } as const;

/**
 * `DELETE /api/v1/admin/staff/:id` (ADR-0028). No body: deletion needs no
 * payload, and the actor re-authentication `setStaffPasswordSchema` carries is
 * deliberately not copied here — the endpoint is already fenced by the rank
 * rule, the last-super-admin invariant and the self-deletion refusal.
 */
export const deleteStaffSchema = { params: staffIdParams } as const;

/**
 * `POST /api/v1/admin/staff/:id/password` — the administrative reset
 * (ADR-0027).
 *
 * `currentPassword` in this body is the **acting** staff member's, not the
 * subject's: the id in the path says who is being changed, and the body says
 * who is asking.
 */
export const setStaffPasswordSchema = {
  params: staffIdParams,
  body: setPasswordBody,
} as const;

/**
 * `POST /api/v1/admin/staff/:id/email` — a super admin setting an operator's
 * address outright (ADR-0071 §7).
 *
 * The same division {@link setStaffPasswordSchema} makes: the id in the path
 * says whose address is being set, `currentPassword` in the body is the
 * **acting** super admin's own. The body is `@repo/contracts`' `setEmailBody`,
 * shared with the users endpoint, because the operation is one operation on
 * two resources.
 */
export const setStaffEmailSchema = {
  params: staffIdParams,
  body: setEmailBody,
} as const;

/**
 * `POST /api/v1/admin/staff/:id/onboarding/resend` (ADR-0071 §8).
 *
 * The id in the path says whose link is re-minted; the body carries only
 * ADR-0071 §2's locale seam, because an `invited` operator has no stored one
 * yet. No credential is re-presented, unlike the two endpoints above: this
 * sends the same message to the same address the row already holds, so there
 * is nothing here that a stolen session could redirect.
 */
export const resendStaffOnboardingSchema = {
  params: staffIdParams,
  body: resendStaffOnboardingBody,
} as const;

/**
 * `/api/v1/admin/profile` — the same staff aggregate seen by its own account
 * (ADR-0027). No `params`: the subject is `ctx.principal`, so there is no id
 * for a caller to tamper with (ADR-0019 §3).
 */
export const updateStaffProfileSchema = {
  body: updateStaffProfileBody,
} as const;
export const changeStaffPasswordSchema = { body: changePasswordBody } as const;
