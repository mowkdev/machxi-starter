import {
  TOKEN_TYPE,
  type AuthResource,
  type ImpersonatorResource,
  type IsoDateTime,
  type PrincipalResource,
  type StaffPrincipalResource,
  type UserPrincipalResource,
} from "@repo/contracts";

import type { StaffRecord } from "../staff/staff.repository.js";
import type { UserRecord } from "../users/users.repository.js";

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
  record: StaffRecord,
): StaffPrincipalResource => ({
  kind: "staff",
  id: record.id,
  email: record.email,
  firstName: record.firstName,
  lastName: record.lastName,
  roles: record.roles,
});

export const toUserPrincipalResource = (
  record: UserRecord,
): UserPrincipalResource => ({
  kind: "user",
  id: record.id,
  email: record.email,
  firstName: record.firstName,
  lastName: record.lastName,
  roles: record.roles,
});

/**
 * The impersonation fact, added to a customer principal on its way out
 * (ADR-0057 §4).
 *
 * Typed on {@link UserPrincipalResource} rather than on the union, and that is
 * the decision rather than a convenience: `StaffPrincipalResource` has no such
 * field because the mint is `/admin/users/:id` only, and a mapper that
 * accepted either shape would be the one place a staff principal could acquire
 * an actor.
 */
export const withImpersonator = (
  principal: UserPrincipalResource,
  impersonatedBy: ImpersonatorResource,
): UserPrincipalResource => ({ ...principal, impersonatedBy });

export interface AuthResourceInput {
  readonly principal: PrincipalResource;
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
}

/**
 * What the **service** issues, which is narrower than what the API returns.
 *
 * `AuthResource.refreshToken` became optional in ADR-0029 because a controller
 * on cookie transport removes it. The service has no such case: every session
 * it creates or rotates has a refresh token, and every caller below the
 * controller depends on that. Narrowing here keeps the optionality in the one
 * layer that can resolve it — the same reasoning `RefreshInput` applies in the
 * other direction — and it is what lets the controller destructure the field
 * without a branch that could never run.
 */
export type IssuedAuthResource = AuthResource & {
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: IsoDateTime;
};

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
}: AuthResourceInput): IssuedAuthResource => ({
  accessToken,
  accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
  refreshToken,
  refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
  tokenType: TOKEN_TYPE,
  principal,
});
