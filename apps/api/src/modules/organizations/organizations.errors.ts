import {
  conflict,
  forbidden,
  notFound,
  type AppError,
} from "../../core/errors/index.js";

/**
 * The organizations module's error factories (ADR-0013).
 *
 * Thin wrappers over the generic ones: they fix the `code` and the message and
 * inherit the status, so there is no new error type and no `instanceof` check
 * anywhere.
 */

/**
 * The organization is not there — **or the caller is not in it** (ADR-0067 §4).
 *
 * One answer for two questions, deliberately. `requireMembership` refuses a
 * non-member with `404` rather than `403` so that organization existence is
 * not disclosed to somebody outside it, which is the reasoning ADR-0019
 * already applies to route existence, and a distinct code here would undo it
 * in the envelope after the status had been careful.
 */
export const organizationNotFound = (): AppError =>
  notFound("Organization not found");

/**
 * A member whose role is below the one the route requires (ADR-0067 §4).
 *
 * `403`, unlike the refusal above: the caller **is** inside the organization
 * and may know it exists, and the difference is what lets a client render "you
 * are not an owner here" rather than a dead end.
 */
export const organizationRoleInsufficient = (): AppError =>
  forbidden("Your role in this organization does not allow that");

/** No membership of that organization for that account. */
export const membershipNotFound = (): AppError =>
  notFound("Membership not found");

/**
 * The last owner cannot leave, be removed or be demoted (ADR-0067 §2).
 *
 * `409` and not `403`: the caller may well be allowed to remove members and to
 * change roles — what the request conflicts with is the organization's state,
 * which is the distinction `STAFF_LAST_SUPER_ADMIN` draws for the invariant
 * ADR-0017 gave this one its shape from.
 */
export const lastOrganizationOwner = (): AppError =>
  conflict(
    "An organization must keep at least one owner",
    "ORGANIZATION_LAST_OWNER",
  );

/**
 * A personal organization refuses its own deletion (ADR-0067 §2).
 *
 * It is soft-deleted inside the owning account's deletion transaction and
 * never on its own, because a user with no organization is a state no query in
 * this repository has a branch for.
 */
export const personalOrganizationUndeletable = (): AppError =>
  conflict(
    "A personal organization is deleted with the account that owns it",
    "ORGANIZATION_PERSONAL_UNDELETABLE",
  );
