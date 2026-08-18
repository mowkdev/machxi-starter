import type { StaffRole, UserRole } from "../enums.js";
import type { IsoDateTime } from "../primitives.js";

/**
 * Responses of the authentication endpoints (ADR-0018).
 *
 * Written by hand rather than inferred from a zod schema: these are what the
 * module mappers must produce, and ADR-0023 keeps resource types independent
 * of both the ORM row and any parsing library.
 */

/** The only token scheme v1 issues; sent as `Authorization: Bearer <token>`. */
export const TOKEN_TYPE = "Bearer";

/**
 * The pair issued by login and by every refresh.
 *
 * Both expiries are absolute ISO-8601 instants rather than a `expiresIn`
 * duration, so a client that was suspended mid-flight cannot miscompute them
 * from a stale clock reading.
 */
export interface TokenPair {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: IsoDateTime;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: IsoDateTime;
  readonly tokenType: typeof TOKEN_TYPE;
}

/**
 * The authenticated staff member, as `GET /api/v1/admin/auth/me` returns it.
 *
 * `roles` are the roles at authentication time; they come from the access
 * token's claims, so a role granted in the last few minutes may not appear yet
 * (ADR-0018 §Authenticated request).
 */
export interface StaffPrincipalResource {
  readonly kind: "staff";
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly roles: readonly StaffRole[];
}

/** The authenticated user, as `GET /api/v1/user/auth/me` returns it. */
export interface UserPrincipalResource {
  readonly kind: "user";
  readonly id: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly roles: readonly UserRole[];
}

/**
 * Whoever is authenticated, discriminated by population (ADR-0017). Staff
 * names are required and user names are nullable because the two tables differ
 * on exactly that point.
 *
 * This is the *wire* principal. The server-side `Principal` (ADR-0010) also
 * carries `sessionId`, which is never sent to a client.
 */
export type PrincipalResource = StaffPrincipalResource | UserPrincipalResource;

/**
 * The body of a successful login, refresh or registration.
 *
 * `principal` is included on refresh as well as login. ADR-0018 leaves that
 * optional; sending it always means a client that restores a session from a
 * stored refresh token needs one call rather than a refresh followed by `me`,
 * and the data is already loaded to re-check that the account is still active.
 *
 * Registration returns it too (`201`), so a newly registered user is signed in
 * without a second round trip; `FEATURE_USER_REGISTRATION` gates the endpoint
 * itself (ADR-0004).
 */
export interface AuthResource extends TokenPair {
  readonly principal: PrincipalResource;
}
