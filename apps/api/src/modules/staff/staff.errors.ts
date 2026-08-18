import {
  conflict,
  forbidden,
  notFound,
  type AppError,
} from "../../core/errors/index.js";

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

/**
 * Only a `super_admin` may grant or revoke `super_admin`.
 *
 * Without this rule the role is self-service: `authorize("admin")` lets an
 * `admin` reach `PATCH /api/v1/admin/staff/:id`, and nothing else would stop
 * them from sending their own id with `roles: ["super_admin"]`. The role that
 * bypasses every other role check must not be reachable from below it
 * (ADR-0017 §Invariants, ADR-0019 §3).
 *
 * Plain `FORBIDDEN`: the caller is authenticated and simply lacks the standing
 * for this particular change, which is exactly what `403` means (ADR-0013).
 */
export const superAdminGrantForbidden = (): AppError =>
  forbidden("Only a super admin may grant or revoke the super admin role");

/**
 * An action aimed at a `super_admin` by somebody who is not one.
 *
 * The sibling of {@link superAdminGrantForbidden}: that one protects the role,
 * this one protects the account holding it. Guarding only the role left the
 * hierarchy inverted from below — an `admin` could not take `super_admin`
 * away, but could disable its holder, or call `sessions/revoke` on them in a
 * loop and keep them permanently logged out. A privilege that everyone it
 * outranks can neutralise is not a privilege (ADR-0017 §Invariants).
 */
export const superAdminTargetForbidden = (): AppError =>
  forbidden("Only a super admin may disable or sign out a super admin");
