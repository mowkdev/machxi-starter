import type { StaffResource } from "@repo/contracts";

import type { StaffRecord } from "./staff.repository.js";

/**
 * Storage row → wire resource (ADR-0012).
 *
 * A pure function, and the only place a staff row becomes something a client
 * sees. `passwordHash` is on the record and has no field here, so it cannot
 * reach a response by omission; dates leave as ISO-8601 instants because the
 * envelope has no other date form.
 */
export const toStaffResource = (record: StaffRecord): StaffResource => ({
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
