import type { Response } from "express";

import { respond } from "../../core/http/index.js";
import type { ValidatedRequest } from "../../core/middleware/index.js";
import type {
  createStaffSchema,
  getStaffSchema,
  listStaffSchema,
  revokeStaffSessionsSchema,
  updateStaffSchema,
} from "./staff.schemas.js";
import type { StaffService } from "./staff.service.js";

/**
 * HTTP adapters for `/api/v1/admin/staff` (ADR-0009).
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
  }) as const;

export type StaffController = ReturnType<typeof createStaffController>;
