import { conflict, notFound, type AppError } from "../../core/errors/index.js";

/**
 * The staff module's error factories (ADR-0013).
 *
 * Thin wrappers over the generic ones: they fix the `code` and the message and
 * inherit the status, so there is no new error type and no `instanceof` check
 * anywhere. Clients branch on the code; the table in `@repo/contracts` says
 * what each one means.
 */

/** No staff account with that id. */
export const staffNotFound = (): AppError => notFound("Staff member not found");

/**
 * `POST /api/v1/admin/staff` with an address the `staff` table already holds.
 *
 * It may name the conflict — unlike public registration, which must not —
 * because the caller is an authenticated admin who can already list every
 * staff address (ADR-0020 §Enumeration).
 */
export const staffEmailTaken = (): AppError =>
  conflict(
    "A staff member with this email already exists",
    "STAFF_EMAIL_TAKEN",
  );

/**
 * The ADR-0017 invariant: at least one active `super_admin` must exist.
 *
 * Raised when an edit would remove the role from, or disable, the only one
 * left. `409` rather than `403`: the caller has the privilege, the system
 * state is what refuses.
 */
export const lastSuperAdmin = (): AppError =>
  conflict(
    "The last active super admin cannot be demoted or disabled",
    "STAFF_LAST_SUPER_ADMIN",
  );
