import type { UserResource } from "@repo/contracts";

import type { UserRecord } from "./users.repository.js";

/**
 * Storage row → wire resource (ADR-0012).
 *
 * One mapper for both segments: `/api/v1/admin/users` and
 * `/api/v1/user/profile` return the same shape, so a client learns it once.
 * `passwordHash` and `deletedAt` are on the record and have no field here —
 * the first must never leave the repository layer, and the second is a storage
 * marker a deleted account reports through `status` instead (ADR-0017).
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
});
