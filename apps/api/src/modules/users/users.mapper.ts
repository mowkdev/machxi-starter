import type {
  FederatedIdentityResource,
  UserProfileResource,
  UserResource,
} from "@repo/contracts";

import type { IdentityRecord, UserRecord } from "./users.repository.js";

/**
 * Storage row → wire resource (ADR-0012).
 *
 * One mapper for both segments: `/api/v1/admin/users` and
 * `/api/v1/user/profile` return the same shape, so a client learns it once.
 * `passwordHash` is on the record and has no field here, which is what keeps
 * it out of every response. `deletedAt` *does* have one, as of step 9: the
 * admin endpoints return soft-deleted accounts on purpose, and without the
 * timestamp a client cannot tell one from a live account (ADR-0012).
 *
 * `identities` are read by a statement of their own and passed in (ADR-0072
 * §3): the aggregate read is also the principal lookup behind every login, and
 * nothing there needs them. The mapper keeps only the ones that belong to the
 * record, so a caller mapping a page hands it the page's identities once.
 */
export const toFederatedIdentityResource = (
  identity: IdentityRecord,
): FederatedIdentityResource => ({
  provider: identity.provider,
  email: identity.email,
  linkedAt: identity.linkedAt.toISOString(),
});

export const toUserResource = (
  record: UserRecord,
  identities: readonly IdentityRecord[],
): UserResource => ({
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
  identities: identities
    .filter((identity) => identity.userId === record.id)
    .map(toFederatedIdentityResource),
});

/**
 * `/api/v1/user/profile`'s shape: the shared resource and whether a password
 * exists (ADR-0072 §3). Derived from the hash here, the one layer that sees
 * both the record and the wire, so the hash itself never leaves.
 */
export const toUserProfileResource = (
  record: UserRecord,
  identities: readonly IdentityRecord[],
): UserProfileResource => ({
  ...toUserResource(record, identities),
  hasPassword: record.passwordHash !== null,
});
