import type { Request, Response } from "express";

import { respond } from "../../core/http/index.js";
import type { ValidatedRequest } from "../../core/middleware/index.js";
import type { AuthService } from "./auth.service.js";
import type {
  loginSchema,
  refreshSchema,
  registerSchema,
} from "./auth.schemas.js";

/**
 * HTTP adapters for the auth endpoints (ADR-0009).
 *
 * Each is one line: read `req.ctx` and `req.valid`, call the service, respond
 * through the envelope. No branching, no error handling, no `res.json` — a
 * failure is an `AppError` thrown by the service and rendered by the error
 * middleware (ADR-0013).
 *
 * The `ValidatedRequest<typeof …Schema>` parameter types are the only thing
 * keeping `req.valid` honest (ADR-0011, amended): the base `Request` types it
 * as `any`, so a controller that does not declare its schema reads an untyped
 * value that compiles and means nothing.
 */
export const createAuthController = (service: AuthService) =>
  ({
    login: async (
      req: ValidatedRequest<typeof loginSchema>,
      res: Response,
    ): Promise<void> => {
      respond.ok(res, await service.login(req.ctx, req.valid.body));
    },

    refresh: async (
      req: ValidatedRequest<typeof refreshSchema>,
      res: Response,
    ): Promise<void> => {
      respond.ok(res, await service.refresh(req.ctx, req.valid.body));
    },

    /** `201`: registration creates an account and signs it in (ADR-0018). */
    register: async (
      req: ValidatedRequest<typeof registerSchema>,
      res: Response,
    ): Promise<void> => {
      respond.created(res, await service.register(req.ctx, req.valid.body));
    },

    /** `204`: the session is gone, and there is nothing to say about it. */
    logout: async (req: Request, res: Response): Promise<void> => {
      await service.logout(req.ctx);
      respond.noContent(res);
    },

    logoutAll: async (req: Request, res: Response): Promise<void> => {
      await service.logoutAll(req.ctx);
      respond.noContent(res);
    },

    me: async (req: Request, res: Response): Promise<void> => {
      respond.ok(res, await service.me(req.ctx));
    },
  }) as const;

export type AuthController = ReturnType<typeof createAuthController>;
