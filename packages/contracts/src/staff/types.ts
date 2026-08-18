import type { StaffRole, StaffStatus } from "../enums.js";
import type { IsoDateTime } from "../primitives.js";

/**
 * A staff member as the admin API returns it (ADR-0012 §Resource shape rules).
 *
 * Deliberately not the `staff` row: `passwordHash` has no wire representation,
 * and the resource must be free to diverge from storage (ADR-0023). The
 * module's mapper is the only place that produces one.
 */
export interface StaffResource {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly status: StaffStatus;
  readonly roles: readonly StaffRole[];
  /** `null` until the account is used for the first time. */
  readonly lastLoginAt: IsoDateTime | null;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}
