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

/**
 * A slug edit aimed at a `personal` organization (ADR-0067 §2, `D15.2`'s
 * review).
 *
 * The same `409` and the same code as the deletion refusal above, because it
 * is the same fact about the same row: a personal organization is the system's
 * to name, not its owner's. Its slug is *derived* from the account's id, which
 * is what proves "exactly one personal organization per live account" without
 * a journal — every path that creates one conflicts on the derived slug and
 * reads the same row back. An editable slug would take that proof away and
 * leave the invariant resting on nothing.
 *
 * The name is freely editable: it is what the switcher renders and it proves
 * nothing.
 */
export const personalOrganizationSlugFixed = (): AppError =>
  conflict(
    "A personal organization's slug is derived from its account and cannot be changed",
    "ORGANIZATION_PERSONAL_UNDELETABLE",
  );

/**
 * A second member aimed at a `personal` organization (ADR-0067 §2).
 *
 * The record leans on "a personal organization has exactly one member" in
 * more places than it looks. Its slug is `personal-<the owner's id>`, and §2
 * bounds that exposure — a uuid and a creation timestamp in a URL — precisely
 * by *"only its owner and staff ever see the slug, and no surface a second
 * party reads may carry one"*. A joiner's `GET /user/orgs` would be exactly
 * such a surface. Beyond the slug: ownership could then be granted away, so
 * `findPersonalFor`'s `created_by` key and the derived slug would name
 * different accounts and the idempotence proof of
 * `ensurePersonalOrganizationFor` would fail; and the creator closing their
 * account soft-deletes the organization, silently evicting anybody else in it.
 *
 * So both paths that could put a second member in one refuse — the invitation
 * on the user segment and the by-id add on the admin one. `409` for the reason
 * the deletion refusal is: the caller holds exactly the role the route
 * requires, and what the request conflicts with is the organization's kind.
 *
 * Found by `D15.3`'s security review; the invariant was a fact of the record
 * with nothing in the code holding it up.
 */
export const personalOrganizationClosed = (): AppError =>
  conflict(
    "A personal organization has exactly one member",
    "ORGANIZATION_PERSONAL_CLOSED",
  );

/**
 * The address already has a pending invitation to this organization.
 *
 * An invitation has no natural key — one address may be invited to one
 * organization many times over its life, once each offer has ended — so
 * nothing in the schema stops a second one while the first is outstanding.
 * Without this check an owner could create them without bound, and the cost
 * lands on somebody else: the invitee's own `GET /user/invitations` is
 * deliberately unpaged, so an unrelated account's list could be made
 * arbitrarily long from an address the inviter never controlled, and the day
 * the mail deliverable fills §2's marked call the same loop becomes a mail
 * bomb aimed at a third party.
 *
 * Distinguishable, like `alreadyAMember` and for the same reason: it tells the
 * inviter only what their own pending list already shows them. It says nothing
 * about whether the address has an account, so the create path stays
 * enumeration-safe (ADR-0020 §Enumeration).
 *
 * Found by `D15.3`'s security review.
 */
export const invitationAlreadyPending = (): AppError =>
  conflict(
    "That address already has a pending invitation to this organization",
    "ORGANIZATION_INVITATION_PENDING",
  );

/**
 * The calling account is gone (ADR-0028).
 *
 * Reachable on the invitee's own surface in the window between a soft delete
 * and its session revocation committing: `authenticate` reads the session row
 * rather than the account, so a request can arrive with a live session for an
 * account that is not there. It is answered as a missing **invitation**
 * because that is the resource the request named — a `404` about an
 * organization on a route with no organization in it would be an error message
 * about something the caller never mentioned (ADR-0013).
 */
export const callerAccountGone = (): AppError => invitationNotFound();

/**
 * The slug is already taken by a live organization (ADR-0067 §2).
 *
 * A generic `CONFLICT`, never a code of its own, and never `details` naming
 * the holder's `kind`: the slug namespace is global, so this answer is already
 * an existence oracle for a *name* — which is unavoidable, a name being the
 * thing being claimed — and saying more would turn it into one for what kind
 * of organization holds it, and therefore for whether an account exists
 * (`D15.1`'s note to this step, ADR-0020 §Enumeration).
 */
export const organizationSlugTaken = (): AppError =>
  conflict("That address is already taken");

/**
 * The address is already a member (ADR-0067 §2).
 *
 * The one distinguishable refusal the invitation flow has, and it is safe for
 * the reason the record gives: it tells the inviter only what the members list
 * they can already read would tell them. Every *other* outcome — an address
 * with an account, an address without one — answers identically, which is what
 * makes the flow enumeration-safe by construction rather than by care.
 */
export const alreadyAMember = (): AppError =>
  conflict("That address is already a member of this organization");

/**
 * The invitation cannot be acted on: accepted, declined, revoked, expired, or
 * its organization deleted.
 *
 * **One answer for five refusals**, deliberately. Four of them are facts the
 * caller could learn another way, but "its organization was deleted" is not,
 * and splitting the message would let an invitee learn that an organization
 * they were never in has gone. The atomic consume produces the same
 * `undefined` for all five, so this is also the only answer that can be given
 * without a second read that could disagree with the write.
 */
export const invitationNotPending = (): AppError =>
  conflict("That invitation is no longer pending");

/** No invitation by that id, or none addressed to the caller (ADR-0067 §2). */
export const invitationNotFound = (): AppError =>
  notFound("Invitation not found");
