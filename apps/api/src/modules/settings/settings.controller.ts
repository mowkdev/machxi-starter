import type { Request, Response } from "express";

import { respond } from "../../core/http/index.js";
import type { ValidatedRequest } from "../../core/middleware/index.js";
import type { UpdateSettingsSchema } from "./settings.schemas.js";
import type { SettingsService } from "./settings.service.js";

/**
 * HTTP adapters for the settings module (ADR-0009).
 *
 * **One controller for both mounts**, unlike the profile pairs beside it. Those
 * are two factories over one service because the admin half takes an `:id`
 * from the URL and the self half must not be able to reach it. Here there is no
 * such half: every handler reads its subject from `ctx.principal` and neither
 * function takes an id, so there is nothing for a second factory to withhold
 * (ADR-0019 §3).
 */
export const createSettingsController = (service: SettingsService) =>
  ({
    get: async (req: Request, res: Response): Promise<void> => {
      respond.ok(res, await service.get(req.ctx));
    },

    /**
     * `200` with the full resource after the merge, not `204`: the client is
     * expected to reconcile against what the server now holds rather than
     * assume its patch landed whole, which is what makes a coalesced write
     * safe to send (ADR-0045).
     */
    update: async (
      req: ValidatedRequest<UpdateSettingsSchema>,
      res: Response,
    ): Promise<void> => {
      respond.ok(res, await service.update(req.ctx, req.valid.body));
    },
  }) as const;

export type SettingsController = ReturnType<typeof createSettingsController>;
