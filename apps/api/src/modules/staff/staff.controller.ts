import type { Request, Response } from "express";

import { respond } from "../../core/http/index.js";
import type { ValidatedRequest } from "../../core/middleware/index.js";
import type {
  changeStaffPasswordSchema,
  createStaffSchema,
  deleteStaffSchema,
  getStaffSchema,
  listStaffSchema,
  revokeStaffSessionsSchema,
  setStaffPasswordSchema,
  updateStaffProfileSchema,
  updateStaffSchema,
} from "./staff.schemas.js";
import type { StaffService } from "./staff.service.js";

/**
 * HTTP adapters for the staff module (ADR-0009).
 *
 * Two factories over one service since D2.3, for the reason the users module
 * has had two since step 9: they are mounted on two paths with different
 * guards, and keeping them apart means `/api/v1/admin/profile` cannot reach a
 * handler that takes an id from the URL — {@link createStaffProfileController}
 * does not have one.
 */

/**
 * `/api/v1/admin/staff` — a staff member acting on somebody else's account.
 *
 * Each is one line: read `req.ctx` and `req.valid`, call the service, respond
 * through the envelope. No branching and no error handling — a failure is an
 * `AppError` thrown by the service and rendered by the error middleware
 * (ADR-0013).
 *
 * The `ValidatedRequest<typeof …Schema>` parameter types are what keep
 * `req.valid` honest (ADR-0011): the base `Request` types it as `any`, so a
 * controller that does not declare its schema reads an untyped value that
 * compiles and means nothing.
 */
export const createStaffController = (service: StaffService) =>
  ({
    list: async (
      req: ValidatedRequest<typeof listStaffSchema>,
      res: Response,
    ): Promise<void> => {
      respond.list(res, await service.list(req.ctx, req.valid.query));
    },

    getById: async (
      req: ValidatedRequest<typeof getStaffSchema>,
      res: Response,
    ): Promise<void> => {
      respond.ok(res, await service.getById(req.ctx, req.valid.params.id));
    },

    create: async (
      req: ValidatedRequest<typeof createStaffSchema>,
      res: Response,
    ): Promise<void> => {
      respond.created(res, await service.create(req.ctx, req.valid.body));
    },

    update: async (
      req: ValidatedRequest<typeof updateStaffSchema>,
      res: Response,
    ): Promise<void> => {
      respond.ok(
        res,
        await service.update(req.ctx, req.valid.params.id, req.valid.body),
      );
    },

    /** `204`: the sessions are gone, and there is nothing to say about it. */
    revokeSessions: async (
      req: ValidatedRequest<typeof revokeStaffSessionsSchema>,
      res: Response,
    ): Promise<void> => {
      await service.revokeSessions(req.ctx, req.valid.params.id);
      respond.noContent(res);
    },

    /**
     * `204`: the password is set and every session of the subject is gone.
     * Reporting how many were revoked would tell the caller how many devices
     * the account was signed in on, which is of no use to them and is not
     * their business.
     */
    setPassword: async (
      req: ValidatedRequest<typeof setStaffPasswordSchema>,
      res: Response,
    ): Promise<void> => {
      await service.setPassword(req.ctx, req.valid.params.id, req.valid.body);
      respond.noContent(res);
    },

    /** `204`: the account is gone, and there is no resource left to describe. */
    remove: async (
      req: ValidatedRequest<typeof deleteStaffSchema>,
      res: Response,
    ): Promise<void> => {
      await service.remove(req.ctx, req.valid.params.id);
      respond.noContent(res);
    },
  }) as const;

export type StaffController = ReturnType<typeof createStaffController>;

/** `/api/v1/admin/profile` — a staff member acting on their own account. */
export const createStaffProfileController = (service: StaffService) =>
  ({
    /** No `:id` and no schema: the account is `ctx.principal` (ADR-0019 §3). */
    get: async (req: Request, res: Response): Promise<void> => {
      respond.ok(res, await service.getProfile(req.ctx));
    },

    update: async (
      req: ValidatedRequest<typeof updateStaffProfileSchema>,
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
      req: ValidatedRequest<typeof changeStaffPasswordSchema>,
      res: Response,
    ): Promise<void> => {
      await service.changePassword(req.ctx, req.valid.body);
      respond.noContent(res);
    },
  }) as const;

export type StaffProfileController = ReturnType<
  typeof createStaffProfileController
>;
