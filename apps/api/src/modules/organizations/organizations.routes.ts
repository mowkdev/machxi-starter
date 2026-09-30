import { Router, type RequestHandler } from "express";

import { authorize, noStore, validate } from "../../core/middleware/index.js";
import type {
  OrganizationsController,
  PublicInvitationsController,
  UserInvitationsController,
  UserOrganizationsController,
} from "./organizations.controller.js";
import {
  placeRouteOrganization,
  type RequireMembership,
} from "./organizations.middleware.js";
import {
  acceptMyInvitationByTokenSchema,
  actOnMyInvitationSchema,
  addOrganizationMemberSchema,
  createOrganizationSchema,
  createOrgInvitationSchema,
  createOrgSchema,
  deleteOrganizationSchema,
  deleteOrgSchema,
  getOrganizationSchema,
  getOrgSchema,
  listOrganizationMembersSchema,
  listOrganizationsSchema,
  listOrgInvitationsSchema,
  listOrgMembersSchema,
  lookupInvitationSchema,
  removeOrganizationMemberSchema,
  removeOrgMemberSchema,
  revokeOrgInvitationSchema,
  setOrganizationMemberRoleSchema,
  setOrgMemberRoleSchema,
  updateOrganizationSchema,
  updateOrgSchema,
} from "./organizations.schemas.js";

/**
 * `/api/v1/user/orgs/*` (ADR-0015 as carried by ADR-0067 §4).
 *
 * The one router in this API whose guard is neither a population nor a role
 * but a **membership**, read per request from the database. Three properties
 * are meant to be readable off this file rather than out of a service:
 *
 * - **The prefix is the resolution mechanism.** A request either names an
 *   organization in its path or it is not an organization request. `GET /` and
 *   `POST /` sit *outside* `/:orgId`, because "which organizations do I have"
 *   and "make me a new one" are about the principal.
 * - **Every route under `/:orgId` states the roles it admits**, and there is
 *   no hierarchy: a route that admits owners and admins names both. Nothing
 *   here mentions `super_admin` — that is `authorize`'s bypass over *staff*
 *   roles, and staff are never members (ADR-0067 §3).
 * - **The exclusion list is read here**, not inferred from a service
 *   (ADR-0067 §8, a delta on ADR-0057 §5).
 *
 * `requireMembership` is mounted per route rather than once over the prefix,
 * because the roles differ per route and one `router.use("/:orgId", …)` could
 * only state the weakest of them. The cost is a line per route; the gain is
 * that "who may do this" sits on the same line as the URL, which is ADR-0019's
 * whole style.
 *
 * `no-store` covers the router: a members list is a list of people's
 * addresses, and a page of one in a shared proxy is a data breach with a cache
 * key (ADR-0020).
 *
 * ## What `refuseImpersonated` guards, and what it deliberately does not
 *
 * ADR-0067 §8 names the writes that would let a support operator hand a third
 * party the customer's **tenant** rather than their account: changing a
 * member's role, removing a member, leaving, granting ownership, deleting an
 * organization, creating an invitation, and accepting one. Those carry the
 * guard.
 *
 * Four things here do **not**, each for a stated reason. *Name and slug edits*
 * are what support opens the app to do, and they land in the mutation trail
 * with both identities like every other impersonated write. *Creating a team
 * organization* gives an impersonator nothing the customer did not already
 * have and takes nothing away. *Revoking an invitation* undoes an offer rather
 * than granting anything, and §8's list does not name it. *Declining one* is
 * the same shape: it ends an offer without creating a membership.
 *
 * The guard sits **before** `validate` on each route, which is ADR-0011's
 * order rather than an exception to it: a request that fails a guard must not
 * first have its body parsed to produce a better error message.
 */
export interface UserOrganizationsRouterDeps {
  readonly controller: UserOrganizationsController;
  /** ADR-0067 §4's third guard, built over the memberships repository. */
  readonly requireMembership: RequireMembership;
  /** ADR-0057 §5's exclusion guard, as ADR-0067 §8 grows it. */
  readonly refuseImpersonated: RequestHandler;
  /**
   * The mailbox's own budget on `POST /:orgId/invitations` (ADR-0071 §5,
   * amended at `D18.7`), keyed on the invited address alone and counted in an
   * instance of its own.
   *
   * Since that step the create **sends a message**, and it is the one sender
   * in this API an ordinary authenticated account drives. See the route below
   * for where it sits in the chain and why that is not ADR-0011's default.
   */
  readonly mailboxRateLimiter: RequestHandler;
}

export const createUserOrganizationsRouter = ({
  controller,
  requireMembership,
  refuseImpersonated,
  mailboxRateLimiter,
}: UserOrganizationsRouterDeps): Router => {
  const router = Router();

  router.use(noStore);

  // Self-scoped, outside the prefix: the caller is the subject (ADR-0067 §4).
  router.get("/", controller.listMine);
  router.post("/", validate(createOrgSchema), controller.create);

  router.get(
    "/:orgId",
    requireMembership(),
    validate(getOrgSchema),
    controller.get,
  );

  router.patch(
    "/:orgId",
    requireMembership("owner", "admin"),
    validate(updateOrgSchema),
    controller.update,
  );

  // An owner, never an admin: deleting the tenant is not delegated. A
  // `personal` organization refuses it outright with `409` (ADR-0067 §2).
  router.delete(
    "/:orgId",
    requireMembership("owner"),
    refuseImpersonated,
    validate(deleteOrgSchema),
    controller.remove,
  );

  router.get(
    "/:orgId/members",
    requireMembership(),
    validate(listOrgMembersSchema),
    controller.listMembers,
  );

  // Only an owner moves roles, because granting `owner` is how ownership moves
  // (ADR-0067 §2) and an admin who could grant it could take the tenant.
  router.patch(
    "/:orgId/members/:userId",
    requireMembership("owner"),
    refuseImpersonated,
    validate(setOrgMemberRoleSchema),
    controller.setMemberRole,
  );

  /*
   * **Any member**, and the rule is finished in the service (ADR-0019 §3):
   * removing somebody else needs `owner` or `admin`, and leaving needs only
   * that the caller is the member named. A guard cannot express "or it is
   * you", so stating `owner, admin` here would refuse a member their own exit
   * and stating nothing here would leave the real rule nowhere. The service
   * compares against `ctx.principal`, which no request can name.
   */
  router.delete(
    "/:orgId/members/:userId",
    requireMembership(),
    refuseImpersonated,
    validate(removeOrgMemberSchema),
    controller.removeMember,
  );

  /*
   * The one route in this file that **sends a message** (ADR-0071 §5), and
   * therefore the one with a budget rationing somebody else's inbox.
   *
   * The limiter is keyed on the invited address alone, so onboarding a team is
   * untouched — thirty invitations to thirty people are thirty budgets — and
   * what it bounds is the same address being mailed over and over. §5 first
   * argued no budget was needed because ADR-0067 §2 refuses a second
   * outstanding offer to one address in one organization; that bound is worth
   * two requests to an attacker (revoke, invite again) and nothing caps how
   * many organizations one account may create, so the real ceiling was the
   * global limiter (`D18.7`'s `security-reviewer`).
   *
   * **It sits after the guards, not first**, which is a stated refinement of
   * ADR-0011's rate-limit-first order rather than an exception somebody
   * invented here — ADR-0057 §1 makes the same kind of statement about the
   * mint. What this rations is a *third party's* inbox, so a caller who is
   * about to be refused anyway must not be able to spend it: first in the
   * chain, any authenticated account could exhaust a chosen address's budget
   * by posting to an organization they are not in, and the limiter would
   * become the denial it exists to prevent. It stays above `validate`, for
   * `keyEmail`'s reason: a body a schema will reject must still count.
   */
  router.post(
    "/:orgId/invitations",
    requireMembership("owner", "admin"),
    refuseImpersonated,
    mailboxRateLimiter,
    validate(createOrgInvitationSchema),
    controller.invite,
  );

  router.get(
    "/:orgId/invitations",
    requireMembership("owner", "admin"),
    validate(listOrgInvitationsSchema),
    controller.listInvitations,
  );

  router.delete(
    "/:orgId/invitations/:id",
    requireMembership("owner", "admin"),
    validate(revokeOrgInvitationSchema),
    controller.revokeInvitation,
  );

  return router;
};

/**
 * `/api/v1/user/invitations/*` — the invitee's own surface (ADR-0067 §4).
 *
 * Outside the `/orgs/:orgId` prefix, and therefore with no `requireMembership`
 * anywhere: the caller is not a member of anything yet, which is the whole
 * point of an invitation. What scopes these routes is the caller's **address**,
 * read from their account rather than from the request, so there is nothing
 * for a caller to name but an invitation addressed to them.
 *
 * `no-store` for the reason the router above has it: an invitation carries an
 * address.
 */
export interface UserInvitationsRouterDeps {
  readonly controller: UserInvitationsController;
  /** ADR-0067 §8 names accepting; declining is deliberately not on the list. */
  readonly refuseImpersonated: RequestHandler;
}

export const createUserInvitationsRouter = ({
  controller,
  refuseImpersonated,
}: UserInvitationsRouterDeps): Router => {
  const router = Router();

  router.use(noStore);

  router.get("/", controller.list);

  // Accepting joins the caller to somebody else's tenant, which is exactly the
  // shape ADR-0067 §8 excludes: a support operator must not be able to walk a
  // customer's account into an organization.
  router.post(
    "/:id/accept",
    refuseImpersonated,
    validate(actOnMyInvitationSchema),
    controller.accept,
  );

  /*
   * The same acceptance, named by the **token** from a mailed link rather than
   * by an id from the caller's own list (ADR-0071 §5).
   *
   * It has no id of its own, and it cannot be read as an invitation whose id
   * happens to be that word whatever the registration order: `/:id/accept`
   * matches two path segments and this matches one.
   *
   * It carries `refuseImpersonated` for the reason the route above does — this
   * is the same join, and ADR-0067 §8 excludes joining, not one way of asking
   * for it. A support operator who could follow a link found in a customer's
   * mailbox would have exactly the affordance that list exists to remove.
   *
   * No limiter: the credential is 256 bits and the caller is already
   * authenticated, so the budget belongs on the *lookup*, which is the
   * unauthenticated half (ADR-0067 §5, ADR-0071 §5).
   */
  router.post(
    "/accept-by-token",
    refuseImpersonated,
    validate(acceptMyInvitationByTokenSchema),
    controller.acceptByToken,
  );

  // Not excluded: declining ends an offer and creates no membership.
  router.post(
    "/:id/decline",
    validate(actOnMyInvitationSchema),
    controller.decline,
  );

  return router;
};

export interface PublicInvitationsRouterDeps {
  readonly controller: PublicInvitationsController;
  /**
   * ADR-0067 §5's first condition, inherited by ADR-0071 §5: a lookup scoped
   * by nothing but a secret is limited **as an authentication route is**,
   * because guessing is the only attack on it.
   *
   * The container builds it with `createTokenRouteRateLimiter` — ADR-0020's
   * numbers on the **source alone**, reading no body — in a counter of its
   * own, so sign-in noise from one office egress cannot refuse its own
   * invitees their link (`D18.5`'s argument for `password/reset`).
   *
   * **Corrected at `D18.8`, on that step's `security-reviewer`.** This
   * paragraph used to say the login limiter's key "degrades to the caller's"
   * on a body with no `email`, which ADR-0071 §4's `D18.7` amendment had
   * already retracted in as many words: it does not degrade, it lets a caller
   * *invent* the field and open a bucket per request. The wiring was already
   * right; the reasoning beside it was the exact reasoning that would lead the
   * next author to mount the login limiter on a token route.
   */
  readonly rateLimiter: RequestHandler;
}

/**
 * `POST /api/v1/public/invitations/lookup` (ADR-0071 §5).
 *
 * The one endpoint of this module outside every guard, and it is outside them
 * because the person holding the link **has no account yet** — that is the
 * case the flow exists for. What stands in for a guard is the token: 256 bits,
 * one row through a unique index, and one `404` for unknown, consumed,
 * declined, expired and deleted alike.
 *
 * **No CSRF guard**, for the reason `login` carries none (ADR-0029 §CSRF): the
 * request leans on nothing in the browser's jar, so there is no cross-site
 * submission whose intent needs proving. It writes nothing either.
 *
 * `no-store` because the answer carries an address and the name of somebody
 * else's organization (ADR-0020).
 */
export const createPublicInvitationsRouter = ({
  controller,
  rateLimiter,
}: PublicInvitationsRouterDeps): Router => {
  const router = Router();

  router.use(noStore);
  router.post(
    "/lookup",
    rateLimiter,
    validate(lookupInvitationSchema),
    controller.lookup,
  );

  return router;
};

/**
 * `/api/v1/admin/organizations/*` (ADR-0067 §3).
 *
 * The users resource's shape, exactly: the segment mounts it behind
 * `authorize("admin", "manager")` because a manager may **read** the tenant
 * base, and every writing route narrows back to `authorize("admin")` — a
 * manager reads the tenants and does not reshape them. Refinement composes in
 * that direction only, both guards running, so a route may narrow the mount
 * and can never widen it (ADR-0019 §2).
 *
 * There is no `requireMembership` in this file and that is the decision rather
 * than an omission: staff are never members (ADR-0067 §3), so there is no
 * membership to resolve, no role to place on the context and no `404`-for-a-
 * non-member to give. A staff member sees every organization, including
 * soft-deleted ones, which is what `GET /:id` answering a deleted row is for.
 *
 * What stands in for it at the database is `placeRouteOrganization` over
 * `/:id` (ADR-0083 §2): the organization the path names is the one tenant a
 * staff request's transactions are scoped to. The cross-tenant list reads
 * `organizations`, which carries no policy, and needs none.
 *
 * `refuseImpersonated` is absent for a structural reason: only a customer
 * principal can carry an actor (ADR-0057 §4), so nothing reachable from the
 * admin segment can be impersonated.
 */
export const createOrganizationsRouter = (
  controller: OrganizationsController,
): Router => {
  const router = Router();

  router.use(noStore);

  router.get("/", validate(listOrganizationsSchema), controller.list);
  router.post(
    "/",
    authorize("admin"),
    validate(createOrganizationSchema),
    controller.create,
  );

  // Every route below names one organization, and that one alone is the
  // tenant its transactions act in (ADR-0083 §2): staff carry no widening,
  // so a staff read of memberships or invitations is scoped by this path.
  router.use("/:id", placeRouteOrganization);

  router.get("/:id", validate(getOrganizationSchema), controller.getById);
  router.patch(
    "/:id",
    authorize("admin"),
    validate(updateOrganizationSchema),
    controller.update,
  );
  router.delete(
    "/:id",
    authorize("admin"),
    validate(deleteOrganizationSchema),
    controller.remove,
  );

  /*
   * The memberships sub-resource — the one path that grants membership without
   * an invitation (ADR-0067 §3), and it takes a **user id** rather than an
   * address because staff already list accounts and there is nothing here to
   * enumerate.
   */
  router.get(
    "/:id/memberships",
    validate(listOrganizationMembersSchema),
    controller.listMembers,
  );
  router.post(
    "/:id/memberships",
    authorize("admin"),
    validate(addOrganizationMemberSchema),
    controller.addMember,
  );
  router.patch(
    "/:id/memberships/:userId",
    authorize("admin"),
    validate(setOrganizationMemberRoleSchema),
    controller.setMemberRole,
  );
  router.delete(
    "/:id/memberships/:userId",
    authorize("admin"),
    validate(removeOrganizationMemberSchema),
    controller.removeMember,
  );

  return router;
};
