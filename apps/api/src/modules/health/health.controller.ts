import type { Request, Response } from "express";

import { respond } from "../../core/http/index.js";
import type { HealthService } from "./health.service.js";

/**
 * HTTP adapters for the health endpoints (ADR-0016).
 *
 * As thin as every other controller (ADR-0009): read the context, call the
 * service, respond through the envelope. A readiness failure is thrown by the
 * service and rendered by the error middleware, so there is no branch here.
 */
export const createHealthController = (service: HealthService) =>
  ({
    live: (req: Request, res: Response): void => {
      respond.ok(res, service.live(req.ctx));
    },

    ready: async (req: Request, res: Response): Promise<void> => {
      respond.ok(res, await service.ready(req.ctx));
    },
  }) as const;

export type HealthController = ReturnType<typeof createHealthController>;
