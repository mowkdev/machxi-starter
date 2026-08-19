import {
  changePasswordBody,
  createStaffBody,
  listStaffQuery,
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
 * `/api/v1/admin/profile` — the same staff aggregate seen by its own account
 * (ADR-0027). No `params`: the subject is `ctx.principal`, so there is no id
 * for a caller to tamper with (ADR-0019 §3).
 */
export const updateStaffProfileSchema = {
  body: updateStaffProfileBody,
} as const;
export const changeStaffPasswordSchema = { body: changePasswordBody } as const;
