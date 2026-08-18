import type { UserRole, UserStatus } from "../enums.js";
import type { IsoDateTime } from "../primitives.js";

/**
 * A user as the API returns it — the same resource on `/api/v1/admin/users`
 * and on `/api/v1/user/profile`, so a client learns one shape (ADR-0012).
 *
 * `deletedAt` is not on the wire: soft deletion is a storage concern, and a
 * deleted account is either absent from a response or reported through
 * `status` (ADR-0017).
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
}
