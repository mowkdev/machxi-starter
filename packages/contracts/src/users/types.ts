import type { FederatedProvider, UserRole, UserStatus } from "../enums.js";
import type { IsoDateTime } from "../primitives.js";

/**
 * A user as the API returns it — the same resource on `/api/v1/admin/users`
 * and on `/api/v1/user/profile`, so a client learns one shape (ADR-0012).
 *
 * **`deletedAt` is on the wire, amended 2026-08-18 (step 9).** It was
 * originally excluded on the grounds that soft deletion is a storage concern
 * and a deleted account is "either absent from a response or reported through
 * `status`". Neither turned out to be true once the admin endpoints existed:
 * `GET /api/v1/admin/users/:id` returns a deleted account on purpose (an admin
 * who can list them must be able to open one) and
 * `filter[deletedAt][null]=false` lists them, while `USER_STATUSES` has no
 * `deleted` member — so the resource rendered a deleted account as `active`
 * and no client could tell. Exposing the timestamp is the smaller change: it
 * is a fact about the account rather than a new status value, and every reader
 * of it is staff. It is always `null` on `/api/v1/user/profile`, which refuses
 * a deleted account outright.
 */
export interface UserResource {
  readonly id: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly status: UserStatus;
  readonly roles: readonly UserRole[];
  /** `null` until the account is used for the first time. */
  readonly lastLoginAt: IsoDateTime | null;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  /** When the account was soft-deleted; `null` for a live one (ADR-0017). */
  readonly deletedAt: IsoDateTime | null;
  /**
   * The external identities linked to the account (ADR-0072 §3) — which
   * Google account signs into it, if any.
   *
   * On both segments: the admin panel reads them (read-only — nothing on the
   * admin segment links or unlinks), and the account's owner reads them on
   * `/user/profile`. Empty for an account with none, never absent. A deleted
   * account has none, because deletion releases them (ADR-0072 §1).
   */
  readonly identities: readonly FederatedIdentityResource[];
}

/**
 * One way into an account through an external provider (ADR-0072 §3).
 *
 * The provider's subject is deliberately **not** here: it is the lookup key a
 * sign-in resolves by, and nothing a client does needs it. `email` is the
 * address the provider reported when the identity was linked — shown so the
 * owner can tell which of their Google accounts it is, and never read to
 * decide anything; `null` when the provider reported none.
 */
export interface FederatedIdentityResource {
  readonly provider: FederatedProvider;
  readonly email: string | null;
  readonly linkedAt: IsoDateTime;
}

/**
 * The account as its owner reads it on `/api/v1/user/profile` (ADR-0072 §3):
 * {@link UserResource} and one more fact.
 *
 * `hasPassword` is here and not on the shared resource because it answers a
 * question only the owner acts on — whether "Change password" or "Set a
 * password" is the control to offer — and the admin segment's resource is left
 * exactly as ADR-0072 §3 grows it, by `identities` alone. A boolean, never the
 * hash.
 */
export interface UserProfileResource extends UserResource {
  readonly hasPassword: boolean;
}
