import { idSchema, type OrganizationRole } from "@repo/contracts";
import type { RequestHandler } from "express";

import { requirePopulation } from "../../core/auth/index.js";
import {
  organizationNotFound,
  organizationRoleInsufficient,
} from "./organizations.errors.js";
import type { MembershipsRepository } from "./memberships.repository.js";

/**
 * `requireMembership(...roles)` — the third guard (ADR-0067 §4, a delta on
 * ADR-0019).
 *
 * ADR-0019 has two: `authenticate(population)` asks who is here, and
 * `authorize(...roles)` asks what standing they hold — both answerable from
 * the token. This one asks a question neither can, because the answer is in
 * the database and is per-organization: **is this caller a member of the
 * organization named in the path, and as what?** It reads that once per
 * request and puts it on the context, so no service below it re-derives it and
 * none can forget to.
 *
 * It lives in this module rather than in `core/middleware` for the reason
 * `authenticate` lives in the auth module (ADR-0011): it holds a repository,
 * and `core` must not import a module or the layering stops being a direction.
 *
 * ## The two refusals, and why they differ
 *
 * A **non-member** gets `404`, not `403`. That is ADR-0019's own reasoning
 * carried one step: the API does not disclose which routes exist to a caller
 * not entitled to know, and an organization's existence is no more disclosable
 * than a route's. A `403` here would turn `/user/orgs/:orgId` into an oracle
 * anyone with a uuid could ask. The same `404` answers a malformed id, an
 * organization that never existed, one that has been soft-deleted, and one the
 * caller simply is not in — one answer for four questions, deliberately.
 *
 * A **member whose role is too low** gets `403`. They are inside the
 * organization and may already know it exists, so withholding that buys
 * nothing, and the difference is what lets a client render "you are not an
 * owner here" instead of a dead end.
 *
 * ## What it places on the context
 *
 * `ctx.organization = { id, slug, role }` (ADR-0010, ADR-0067 §4) — the
 * caller's **resolved membership**, not a route parameter. Only the guard that
 * checks writes the field, so there is no "the organization is in the path but
 * nobody verified the membership" state for a service to be tricked by.
 */

/** The route parameter every organization-scoped path names (ADR-0067 §4). */
export const ORGANIZATION_PARAM = "orgId";

export interface RequireMembershipDeps {
  readonly memberships: MembershipsRepository;
}

export const createRequireMembership = ({
  memberships,
}: RequireMembershipDeps) => {
  /**
   * @param roles the membership roles allowed through. **Empty means any
   *   member**, which is the guard's most common mount — "you must be in this
   *   organization" is a real requirement and the majority of the routes' one.
   *
   *   There is no hierarchy: `requireMembership("admin")` does not admit an
   *   owner. That is `authorize`'s semantics (an explicit allow-list, the
   *   `super_admin` bypass apart) and it keeps a route's guard readable
   *   without a rank table — the routes that mean "owner or admin" say
   *   `requireMembership("owner", "admin")`.
   */
  return (...roles: readonly OrganizationRole[]): RequestHandler => {
    return async (req, _res, next) => {
      // Staff are never members (ADR-0067 §3) and this guard only mounts on
      // the user segment, so a staff principal here is a wiring mistake and is
      // answered `401` like every other one (ADR-0019, amended).
      const principal = requirePopulation(req.ctx, "user");

      // The guard runs at the mount, above the route's own zod validation, so
      // it parses its one parameter itself. A malformed id is `404` and not a
      // `400`: it is the same non-answer a stranger's organization gets, and
      // it also keeps a non-uuid out of a `where id = $1` that would otherwise
      // fail in Postgres and escape as a `500`.
      const parsed = idSchema.safeParse(req.params[ORGANIZATION_PARAM]);

      if (!parsed.success) throw organizationNotFound();

      // One round trip: the membership joined to a **live** organization, so a
      // soft-deleted tenant resolves to nothing rather than to a membership
      // inside it (the memberships repository says why the join is not
      // optional).
      const membership = await memberships.resolveFor(
        parsed.data,
        principal.id,
      );

      if (membership === undefined) throw organizationNotFound();

      if (roles.length > 0 && !roles.includes(membership.role)) {
        throw organizationRoleInsufficient();
      }

      req.ctx.organization = {
        id: membership.organizationId,
        slug: membership.slug,
        role: membership.role,
      };

      // Both facts on every line below this point, for the reason the
      // principal is bound here (ADR-0010, ADR-0005): a cross-tenant question
      // asked of the logs is answerable only if the tenant is on the line.
      req.ctx.logger = req.ctx.logger.child({
        organizationId: membership.organizationId,
        organizationRole: membership.role,
      });

      next();
    };
  };
};

export type RequireMembership = ReturnType<typeof createRequireMembership>;

/** The route parameter every staff organization path names (ADR-0067 §3). */
export const STAFF_ORGANIZATION_PARAM = "id";

/**
 * `placeRouteOrganization` — the staff segment's scope (ADR-0083 §2).
 *
 * Staff hold no membership (ADR-0067 §3), so `requireMembership` has nothing
 * to resolve for them and must never run on this segment. What they do have is
 * a route that names one organization, `/admin/organizations/:id/…`, and this
 * guard puts that id on the context, where the transaction opener reads it and
 * places it as `app.organization_id` exactly as it places a member's. A staff
 * read or write of memberships and invitations then sees that organization
 * alone, and a staff request under no such route places nothing at all — so a
 * staff query that forgets its organization reads nothing, as a member's does.
 *
 * **It decides nothing.** Who may reach the route is `authenticate("staff")`
 * and `authorize` at the mount; whether the organization exists is the
 * service's read. This only tells Postgres which tenant the route is about.
 *
 * A malformed id places nothing and passes on: the route's own `validate`
 * answers it as it always has, and a non-uuid never reaches the setting, where
 * the policies' `::uuid` cast would turn it into a `500`.
 */
export const placeRouteOrganization: RequestHandler = (req, _res, next) => {
  const parsed = idSchema.safeParse(req.params[STAFF_ORGANIZATION_PARAM]);

  if (parsed.success) req.ctx.routeOrganizationId = parsed.data;

  next();
};
