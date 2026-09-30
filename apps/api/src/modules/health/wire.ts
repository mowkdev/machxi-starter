import type { AppConfig } from "../../core/config/index.js";
import type { DbClient } from "../../core/db/index.js";
import { createHealthController } from "./health.controller.js";
import { createDbIndicator } from "./health.indicators.js";
import { createHealthService } from "./health.service.js";

/** What the composition root hands this module (ADR-0073 §10). */
export interface WireHealthDeps {
  readonly config: AppConfig;
  /** The client itself, not an executor: the indicator probes the connection. */
  readonly db: DbClient;
}

/**
 * The health module's wiring (ADR-0073 §10).
 *
 * One `wire<Module>` per module, so a fork that adds an indicator or a
 * controller changes this file rather than the composition root — which is
 * where every fork's merge conflict used to land.
 */
export const wireHealth = ({ config, db }: WireHealthDeps) => {
  const health = createHealthService({
    // The database is the only registered indicator in the first deliverable
    // (ADR-0016); a cache or a queue is one more entry in this array.
    indicators: [createDbIndicator(db)],
    config,
  });

  return {
    /** No table of its own: health reads other people's connections. */
    repositories: {} as const,
    services: { health } as const,
    controllers: {
      health: createHealthController(health, {
        metricsToken: config.metrics.token,
      }),
    } as const,
  } as const;
};
