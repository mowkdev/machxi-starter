import type { UserResource } from "@repo/contracts";

import type { UserRecord } from "./users.repository.js";

/**
 * Storage row → wire resource (ADR-0012).
 *
 * One mapper for both segments: `/api/v1/admin/users` and
 * `/api/v1/user/profile` return the same shape, so a client learns it once.
 * `passwordHash` is on the record and has no field here, which is what keeps
 * it out of every response. `deletedAt` *does* have one, as of step 9: the
 * admin endpoints return soft-deleted accounts on purpose, and without the
 * timestamp a client cannot tell one from a live account (ADR-0012).
 */
export const toUserResource = (record: UserRecord): UserResource => ({
  id: record.id,
  email: record.email,
  firstName: record.firstName,
  lastName: record.lastName,
  status: record.status,
  roles: record.roles,
  lastLoginAt: record.lastLoginAt?.toISOString() ?? null,
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
  deletedAt: record.deletedAt?.toISOString() ?? null,
});
