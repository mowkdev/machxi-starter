import type { Request, Response } from "express";

import { respond } from "../../core/http/index.js";
import { carriesMetricsToken } from "../../core/metrics/index.js";
import type { HealthDisclosure, HealthService } from "./health.service.js";

export interface HealthControllerDeps {
  /**
   * `METRICS_TOKEN`, or `undefined` when the deployment set none. With none
   * configured no request carries it, so `/health` never answers the commit
   * (ADR-0084 §3).
   */
  readonly metricsToken: string | undefined;
}

/**
 * HTTP adapters for the health endpoints (ADR-0016).
 *
 * As thin as every other controller (ADR-0009): read the context, call the
 * service, respond through the envelope. A readiness failure is thrown by the
 * service and rendered by the error middleware, so there is no branch here.
 *
 * The one thing read off the request is whether it carries the metrics token,
 * checked by the same constant-time comparison `/metrics` uses: the commit is
 * answered to the operator, not the public (ADR-0084 §3). A missing or wrong
 * token is not an error — the caller gets the public view, with no hint that
 * there was anything more to see (ADR-0013).
 */
export const createHealthController = (
  service: HealthService,
  { metricsToken }: HealthControllerDeps,
) => {
  const disclosure = (req: Request): HealthDisclosure => ({
    commit: carriesMetricsToken(req, metricsToken),
  });

  return {
    live: (req: Request, res: Response): void => {
      respond.ok(res, service.live(req.ctx, disclosure(req)));
    },

    ready: async (req: Request, res: Response): Promise<void> => {
      respond.ok(res, await service.ready(req.ctx, disclosure(req)));
    },
  } as const;
};

export type HealthController = ReturnType<typeof createHealthController>;
