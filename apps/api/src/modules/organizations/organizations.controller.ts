import type { Request, Response } from "express";

import { requirePopulation } from "../../core/auth/index.js";
import { internal } from "../../core/errors/index.js";
import { respond } from "../../core/http/index.js";
import type { ValidatedRequest } from "../../core/middleware/index.js";
import type {
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
  removeOrganizationMemberSchema,
  removeOrgMemberSchema,
  revokeOrgInvitationSchema,
  setOrganizationMemberRoleSchema,
  setOrgMemberRoleSchema,
  updateOrganizationSchema,
  updateOrgSchema,
} from "./organizations.schemas.js";
import type { OrganizationsService } from "./organizations.service.js";

/**
 * HTTP adapters for the organizations module (ADR-0009).
 *
 * **Three factories over one service**, because the module is mounted in three
 * places behind three different guards, and keeping them apart is what stops a
 * routing mistake exposing a handler where it does not belong — the same
 * reason the users module has two. There is no way to reach `createForOwner`,
 * which names an owner by id, from the user segment: the user-segment factory
 * does not have it.
 *
 * The organization a user-segment handler acts on comes from **`ctx`, not from
 * the URL**. `requireMembership` put it there after resolving the caller's
 * membership (ADR-0067 §4), so a handler reading it knows the caller is a
 * member and knows as what; `req.valid.params.orgId` is the same string with
 * none of that behind it, and the difference is the whole guard.
 */

/**
 * The organization the guard resolved for this request.
 *
 * `null` is unreachable through any mounted route — every path in the
 * user-segment router sits under `requireMembership` — so it is a wiring
 * mistake and answers `500`, never a guess. A `403` here would be the worse
 * answer: it would let a router mounted without its guard look like a
 * permissions problem instead of the bug it is.
 */
const scope = (req: Request) => {
  const { organization } = req.ctx;

  if (organization === null) {
    throw internal(
      new Error("an organization route ran without requireMembership"),
    );
  }

  return organization;
};

/** `/api/v1/user/orgs` — a member acting inside their own organization. */
export const createUserOrganizationsController = (
  service: OrganizationsService,
) =>
  ({
    /** No schema: the subject is `ctx.principal` (ADR-0019 §3). */
    listMine: async (req: Request, res: Response): Promise<void> => {
      respond.ok(res, await service.listMine(req.ctx));
    },

    create: async (
      req: ValidatedRequest<typeof createOrgSchema>,
      res: Response,
    ): Promise<void> => {
      respond.created(res, await service.createTeam(req.ctx, req.valid.body));
    },

    get: async (
      req: ValidatedRequest<typeof getOrgSchema>,
      res: Response,
    ): Promise<void> => {
      const { id, role } = scope(req);

      respond.ok(res, await service.getForMember(req.ctx, id, role));
    },

    update: async (
      req: ValidatedRequest<typeof updateOrgSchema>,
      res: Response,
    ): Promise<void> => {
      const { id, role } = scope(req);

      respond.ok(res, await service.update(req.ctx, id, req.valid.body, role));
    },

    /** `204`: the organization is soft-deleted and nothing is left to render. */
    remove: async (
      req: ValidatedRequest<typeof deleteOrgSchema>,
      res: Response,
    ): Promise<void> => {
      await service.remove(req.ctx, scope(req).id);
      respond.noContent(res);
    },

    listMembers: async (
      req: ValidatedRequest<typeof listOrgMembersSchema>,
      res: Response,
    ): Promise<void> => {
      respond.list(
        res,
        await service.listMembers(req.ctx, scope(req).id, req.valid.query),
      );
    },

    setMemberRole: async (
      req: ValidatedRequest<typeof setOrgMemberRoleSchema>,
      res: Response,
    ): Promise<void> => {
      await service.setMemberRole(
        req.ctx,
        scope(req).id,
        req.valid.params.userId,
        req.valid.body.role,
      );
      respond.noContent(res);
    },

    /**
     * Removing a member, and **leaving** — one write with one invariant
     * (ADR-0067 §2): the last owner may do neither, and which of the two it is
     * only changes who was allowed to ask, a question the route's guard
     * answers rather than this handler.
     */
    removeMember: async (
      req: ValidatedRequest<typeof removeOrgMemberSchema>,
      res: Response,
    ): Promise<void> => {
      const { id, role } = scope(req);
      const principal = requirePopulation(req.ctx, "user");

      await service.removeMember(req.ctx, id, req.valid.params.userId, {
        // The caller's own id, from the principal and never from the request:
        // "or it is you" is only a rule if nothing a client sends can answer
        // it.
        userId: principal.id,
        role,
      });
      respond.noContent(res);
    },

    invite: async (
      req: ValidatedRequest<typeof createOrgInvitationSchema>,
      res: Response,
    ): Promise<void> => {
      respond.created(
        res,
        await service.invite(req.ctx, scope(req).id, req.valid.body),
      );
    },

    listInvitations: async (
      req: ValidatedRequest<typeof listOrgInvitationsSchema>,
      res: Response,
    ): Promise<void> => {
      respond.list(
        res,
        await service.listInvitations(req.ctx, scope(req).id, req.valid.query),
      );
    },

    revokeInvitation: async (
      req: ValidatedRequest<typeof revokeOrgInvitationSchema>,
      res: Response,
    ): Promise<void> => {
      await service.revokeInvitation(
        req.ctx,
        scope(req).id,
        req.valid.params.id,
      );
      respond.noContent(res);
    },
  }) as const;

export type UserOrganizationsController = ReturnType<
  typeof createUserOrganizationsController
>;

/**
 * `/api/v1/user/invitations` — the invitee's own surface.
 *
 * Self-scoped and outside the `/orgs/:orgId` prefix (ADR-0067 §4): every
 * handler here reads the caller's **address** from their account, so there is
 * no organization in the path and nothing for a caller to name but an
 * invitation they were shown.
 */
export const createUserInvitationsController = (
  service: OrganizationsService,
) =>
  ({
    list: async (req: Request, res: Response): Promise<void> => {
      respond.ok(res, await service.listMyInvitations(req.ctx));
    },

    /**
     * `200` with the organization joined, rather than `204`: the client's next
     * act is to switch into it, and answering with the organization it just
     * gained saves the round trip the switcher would otherwise make.
     */
    accept: async (
      req: ValidatedRequest<typeof actOnMyInvitationSchema>,
      res: Response,
    ): Promise<void> => {
      respond.ok(
        res,
        await service.acceptInvitation(req.ctx, req.valid.params.id),
      );
    },

    decline: async (
      req: ValidatedRequest<typeof actOnMyInvitationSchema>,
      res: Response,
    ): Promise<void> => {
      await service.declineInvitation(req.ctx, req.valid.params.id);
      respond.noContent(res);
    },
  }) as const;

export type UserInvitationsController = ReturnType<
  typeof createUserInvitationsController
>;

/** `/api/v1/admin/organizations` — staff above the tenants (ADR-0067 §3). */
export const createOrganizationsController = (service: OrganizationsService) =>
  ({
    list: async (
      req: ValidatedRequest<typeof listOrganizationsSchema>,
      res: Response,
    ): Promise<void> => {
      respond.list(res, await service.list(req.ctx, req.valid.query));
    },

    getById: async (
      req: ValidatedRequest<typeof getOrganizationSchema>,
      res: Response,
    ): Promise<void> => {
      respond.ok(res, await service.getAnyById(req.ctx, req.valid.params.id));
    },

    create: async (
      req: ValidatedRequest<typeof createOrganizationSchema>,
      res: Response,
    ): Promise<void> => {
      respond.created(
        res,
        await service.createForOwner(req.ctx, req.valid.body),
      );
    },

    update: async (
      req: ValidatedRequest<typeof updateOrganizationSchema>,
      res: Response,
    ): Promise<void> => {
      respond.ok(
        res,
        // `null`, always: staff hold no membership here and therefore no role
        // (ADR-0067 §3).
        await service.update(
          req.ctx,
          req.valid.params.id,
          req.valid.body,
          null,
        ),
      );
    },

    remove: async (
      req: ValidatedRequest<typeof deleteOrganizationSchema>,
      res: Response,
    ): Promise<void> => {
      await service.remove(req.ctx, req.valid.params.id);
      respond.noContent(res);
    },

    listMembers: async (
      req: ValidatedRequest<typeof listOrganizationMembersSchema>,
      res: Response,
    ): Promise<void> => {
      respond.list(
        res,
        await service.listMembersForStaff(
          req.ctx,
          req.valid.params.id,
          req.valid.query,
        ),
      );
    },

    addMember: async (
      req: ValidatedRequest<typeof addOrganizationMemberSchema>,
      res: Response,
    ): Promise<void> => {
      await service.addMember(
        req.ctx,
        req.valid.params.id,
        req.valid.body.userId,
        req.valid.body.role,
      );
      respond.noContent(res);
    },

    setMemberRole: async (
      req: ValidatedRequest<typeof setOrganizationMemberRoleSchema>,
      res: Response,
    ): Promise<void> => {
      await service.setMemberRole(
        req.ctx,
        req.valid.params.id,
        req.valid.params.userId,
        req.valid.body.role,
      );
      respond.noContent(res);
    },

    removeMember: async (
      req: ValidatedRequest<typeof removeOrganizationMemberSchema>,
      res: Response,
    ): Promise<void> => {
      // `null`: staff hold no membership, so there is no role to compare and
      // nothing they could be leaving (ADR-0067 §3).
      await service.removeMember(
        req.ctx,
        req.valid.params.id,
        req.valid.params.userId,
        null,
      );
      respond.noContent(res);
    },
  }) as const;

export type OrganizationsController = ReturnType<
  typeof createOrganizationsController
>;
