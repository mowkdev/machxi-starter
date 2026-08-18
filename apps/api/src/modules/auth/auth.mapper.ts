import {
  TOKEN_TYPE,
  type AuthResource,
  type PrincipalResource,
  type StaffPrincipalResource,
  type UserPrincipalResource,
} from "@repo/contracts";

import type { StaffAuthRecord } from "../staff/staff.repository.js";
import type { UserAuthRecord } from "../users/users.repository.js";

/**
 * Storage row → wire resource (ADR-0012).
 *
 * Pure functions, and the only place a principal becomes something a client
 * sees. That is what keeps `passwordHash` and `status` inside the repository
 * layer: they exist on the record types and simply have no field to land in
 * here, so no endpoint can leak them by forgetting to strip them.
 *
 * There are two functions rather than one generic mapper because the two
 * populations genuinely differ — staff names are `not null`, user names are
 * nullable (ADR-0017) — and the resource types say so.
 */

export const toStaffPrincipalResource = (
  record: StaffAuthRecord,
): StaffPrincipalResource => ({
  kind: "staff",
  id: record.id,
  email: record.email,
  firstName: record.firstName,
  lastName: record.lastName,
  roles: record.roles,
});

export const toUserPrincipalResource = (
  record: UserAuthRecord,
): UserPrincipalResource => ({
  kind: "user",
  id: record.id,
  email: record.email,
  firstName: record.firstName,
  lastName: record.lastName,
  roles: record.roles,
});

export interface AuthResourceInput {
  readonly principal: PrincipalResource;
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
}

/**
 * The body of login, refresh and registration (ADR-0018).
 *
 * Both expiries go out as absolute ISO-8601 instants, not as a `expiresIn`
 * duration: a client that was suspended between the request and the response
 * would compute the wrong deadline from a duration, and the refresh token's
 * lifetime is measured in days, where that drift matters.
 */
export const toAuthResource = ({
  principal,
  accessToken,
  accessTokenExpiresAt,
  refreshToken,
  refreshTokenExpiresAt,
}: AuthResourceInput): AuthResource => ({
  accessToken,
  accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
  refreshToken,
  refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
  tokenType: TOKEN_TYPE,
  principal,
});
