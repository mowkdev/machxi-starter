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
  /**
   * **Absent when the client asked for cookie transport** (ADR-0029).
   *
   * `X-Auth-Transport: cookie` on `login`, `refresh` or `register` moves this
   * value into an `httpOnly` cookie, and its absence here is the signal that
   * it went there: a browser client cannot read it and does not need to, since
   * the browser attaches it to `/auth/refresh` on its own.
   *
   * It is still present for every `body`-transport caller — the default, and
   * what mobile clients and Postman use — so this is optional in the type and
   * unconditional in practice for anyone who did not opt in.
   *
   * `refreshTokenExpiresAt` stays either way: knowing when the session ends is
   * useful even to a client that cannot see the credential.
   */
  readonly refreshToken?: string;
  readonly refreshTokenExpiresAt: IsoDateTime;
  /**
   * **Present only on cookie transport** (ADR-0029 §CSRF): the value the
   * client must echo in `X-CSRF-Token` on `refresh`, `logout` and
   * `logout-all`.
   *
   * It is also set as this population's CSRF cookie —
   * `__Host-machxi.csrf.admin` on the `/admin` segment,
   * `__Host-machxi.csrf.user` on `/user` (ADR-0056, superseding ADR-0029 on
   * that name alone) — and that copy is the one a page uses after a reload.
   * One name per population so that two SPAs against one API host cannot
   * strand each other's tokens. This one exists because the two are not
   * interchangeable: an app served from a different host than the API — the
   * deployment `CORS_ORIGINS` and `credentials: true` exist for — can never
   * read the API's cookies from `document.cookie`, so without this it could
   * not satisfy the check at all.
   *
   * It is not a credential: it grants nothing on its own, and its only job is
   * to prove that whoever sent the request could read a response or a cookie
   * from this origin, which a cross-site attacker cannot.
   */
  readonly csrfToken?: string;
  readonly tokenType: typeof TOKEN_TYPE;
}

/**
 * The authenticated staff member, as `GET /api/v1/admin/auth/me` returns it.
 *
 * `roles` here are read fresh from the database — `me` exists precisely so a
 * client can resynchronise (ADR-0018 §Me). They may therefore differ from the
 * roles the same principal is *authorised* with on an ordinary request, which
 * come from the access token's claims and are up to one token lifetime stale
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

/**
 * The staff member behind an impersonated customer session (ADR-0057 §4).
 *
 * Enough to name a person in the banner and no more: an id for the trail and
 * an email for the sentence a support operator reads. Roles are deliberately
 * absent — nothing on the customer app authorises anything against them, and
 * a role list the customer's own screens can read is an invitation to.
 */
export interface ImpersonatorResource {
  readonly id: string;
  readonly email: string;
}

/** The authenticated user, as `GET /api/v1/user/auth/me` returns it. */
export interface UserPrincipalResource {
  readonly kind: "user";
  readonly id: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly roles: readonly UserRole[];
  /**
   * Present only while this session was minted by impersonation (ADR-0057 §4).
   *
   * **The impersonation fact travels here and nowhere else** — never a URL
   * parameter, never `localStorage`, never client state. The handoff fragment
   * is the one-time credential, not the fact; this field is the fact. Two
   * properties follow from that, and both are the reason the design is a
   * field on the principal rather than anything the client keeps: it survives
   * a reload, because the session does and the principal is re-fetched with
   * it, and it cannot be forged, because only the API sets it. The banner
   * (ADR-0057 §7) renders from this and from nothing else.
   *
   * Optional rather than `| null`: an ordinary session's principal has no such
   * key at all, so a client written before impersonation existed parses this
   * one unchanged (ADR-0015 — adding a field is additive).
   *
   * Resolved from the `staff` table at the auth endpoints only — exchange,
   * refresh and `me` — never per request; the session row is the source of
   * truth, and the access token carries the id in its actor claim so an
   * ordinary request needs no second lookup.
   *
   * Staff never carry it: the mint is `/admin/users/:id` only, so a staff
   * principal is never impersonated and {@link StaffPrincipalResource} is
   * deliberately unchanged.
   */
  readonly impersonatedBy?: ImpersonatorResource;
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
 * The body of `GET /api/v1/{user,admin}/auth/csrf` (ADR-0030).
 *
 * The bootstrap a browser client runs before it can refresh: the endpoint sets
 * or rotates **its own segment's** CSRF cookie — `__Host-machxi.csrf.admin` or
 * `__Host-machxi.csrf.user` (ADR-0056) — and returns the same value here,
 * because the two copies serve different deployments. A same-host app could
 * read the cookie back after a reload; an app on `admin.example.com` against
 * `api.example.com` never can, and this is the only copy it will ever see
 * (ADR-0029 §CSRF, amended D2.5).
 *
 * Not part of {@link AuthResource}: nothing is authenticated here, no token is
 * issued, and the endpoint exists precisely for the moment when the client
 * holds no session at all.
 */
export interface CsrfResource {
  readonly csrfToken: string;
}

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
 * itself (ADR-0004). That means registration creates a session row and is
 * subject to the same rate limits as login (ADR-0020). A registration that
 * collides with an existing email answers `409 CONFLICT` without naming the
 * conflict, per ADR-0020 §Enumeration — never `USER_EMAIL_TAKEN`.
 */
export interface AuthResource extends TokenPair {
  readonly principal: PrincipalResource;
}
