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
 * `POST /api/v1/admin/staff/:id/onboarding/resend` on a row that is not
 * `invited` (ADR-0071 §8).
 *
 * `409` rather than `404` or `403`, for {@link lastSuperAdmin}'s reason: the
 * account exists, the caller has the privilege, and what refuses is the row's
 * state — an operator who has already chosen a password has no pending
 * invitation to replace, and one an admin has disabled must not be handed a
 * way back in by mail. It names the conflict because only an authenticated
 * `admin` reaches it, and they can already read the status they are being
 * told about.
 */
export const staffNotInvited = (): AppError =>
  conflict(
    "Only an invited staff member can be sent an onboarding link",
    "STAFF_NOT_INVITED",
  );

/**
 * An operation aimed at an operator who has not accepted their invitation
 * (ADR-0071 §8) — {@link staffNotInvited}'s mirror.
 *
 * Two callers, and the same sentence is true of both. `POST /:id/password`
 * has no password to replace: the row's hash is null and the invitation is
 * how it gets one, so writing a hash there would hand over a credential the
 * account cannot sign in with — `status` would still be `invited` — and the
 * `204` would be a claim nobody could act on. And `PATCH /:id { status:
 * "active" }` would produce the same row from the other direction: `active`
 * with no password, which every other path in this module treats as
 * impossible and which `countOtherActiveSuperAdmins` would count as a
 * survivor.
 *
 * `409` for {@link lastSuperAdmin}'s reason: the caller has the privilege and
 * what refuses is the row's state.
 */
export const staffInvitationPending = (): AppError =>
  conflict(
    "This staff member has not accepted their invitation yet",
    "STAFF_INVITATION_PENDING",
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

/**
 * `DELETE /api/v1/admin/staff/:id` aimed at the caller's own account
 * (ADR-0028 rule 4).
 *
 * Plain `FORBIDDEN` and no new code, the shape {@link superAdminGrantForbidden}
 * uses: this is a rule about standing, not a state the system is in.
 *
 * Self-deletion is the one delete whose actor vanishes mid-request, and the
 * only one that interacts with the last-super-admin invariant from the inside.
 * Refusing it outright removes a class of question for one line; an operator
 * who wants out is deleted by another admin.
 */
export const selfDeletionForbidden = (): AppError =>
  forbidden("A staff member cannot delete their own account");
