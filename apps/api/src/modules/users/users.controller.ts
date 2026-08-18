import type { Request, Response } from "express";

import { respond } from "../../core/http/index.js";
import type { ValidatedRequest } from "../../core/middleware/index.js";
import type {
  changePasswordSchema,
  createUserSchema,
  getUserSchema,
  listUsersSchema,
  revokeUserSessionsSchema,
  setUserPasswordSchema,
  updateProfileSchema,
  updateUserSchema,
} from "./users.schemas.js";
import type { UsersService } from "./users.service.js";

/**
 * HTTP adapters for the users module (ADR-0009).
 *
 * Two factories over one service, because they are mounted on two segments
 * with different guards. Keeping them apart means a route file can only reach
 * the handlers its segment is allowed to expose: there is no way to mount
 * `update` — which takes an id from the URL — inside `/api/v1/user/profile`,
 * because {@link createUserProfileController} does not have it.
 */

/** `/api/v1/admin/users` — staff acting on somebody else's account. */
export const createUsersController = (service: UsersService) =>
  ({
    list: async (
      req: ValidatedRequest<typeof listUsersSchema>,
      res: Response,
    ): Promise<void> => {
      respond.list(res, await service.list(req.ctx, req.valid.query));
    },

    getById: async (
      req: ValidatedRequest<typeof getUserSchema>,
      res: Response,
    ): Promise<void> => {
      respond.ok(res, await service.getById(req.ctx, req.valid.params.id));
    },

    create: async (
      req: ValidatedRequest<typeof createUserSchema>,
      res: Response,
    ): Promise<void> => {
      respond.created(res, await service.create(req.ctx, req.valid.body));
    },

    update: async (
      req: ValidatedRequest<typeof updateUserSchema>,
      res: Response,
    ): Promise<void> => {
      respond.ok(
        res,
        await service.update(req.ctx, req.valid.params.id, req.valid.body),
      );
    },

    /** `204`: the sessions are gone, and there is nothing to say about it. */
    revokeSessions: async (
      req: ValidatedRequest<typeof revokeUserSessionsSchema>,
      res: Response,
    ): Promise<void> => {
      await service.revokeSessions(req.ctx, req.valid.params.id);
      respond.noContent(res);
    },

    /**
     * `204`: the password is set and every session of the subject is gone.
     * Reporting how many were revoked would tell the caller how many devices
     * the account was signed in on, which is of no use to them.
     */
    setPassword: async (
      req: ValidatedRequest<typeof setUserPasswordSchema>,
      res: Response,
    ): Promise<void> => {
      await service.setPassword(req.ctx, req.valid.params.id, req.valid.body);
      respond.noContent(res);
    },
  }) as const;

export type UsersController = ReturnType<typeof createUsersController>;

/** `/api/v1/user/profile` — a user acting on their own account. */
export const createUserProfileController = (service: UsersService) =>
  ({
    /** No `:id` and no schema: the account is `ctx.principal` (ADR-0019 §3). */
    get: async (req: Request, res: Response): Promise<void> => {
      respond.ok(res, await service.getProfile(req.ctx));
    },

    update: async (
      req: ValidatedRequest<typeof updateProfileSchema>,
      res: Response,
    ): Promise<void> => {
      respond.ok(res, await service.updateProfile(req.ctx, req.valid.body));
    },

    /**
     * `204`: the password changed and the other sessions ended. Returning how
     * many were revoked would tell a caller who just proved they hold the
     * password how many devices to expect to be signed out — true, but of no
     * use to the legitimate owner and a hint to anybody else.
     */
    changePassword: async (
      req: ValidatedRequest<typeof changePasswordSchema>,
      res: Response,
    ): Promise<void> => {
      await service.changePassword(req.ctx, req.valid.body);
      respond.noContent(res);
    },
  }) as const;

export type UserProfileController = ReturnType<
  typeof createUserProfileController
>;
