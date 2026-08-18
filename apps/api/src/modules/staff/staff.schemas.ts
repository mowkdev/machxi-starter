import {
  createStaffBody,
  listStaffQuery,
  staffIdParams,
  updateStaffBody,
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
