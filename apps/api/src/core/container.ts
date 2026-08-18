import type { Logger } from "@repo/logger";

import type { AppConfig } from "./config/index.js";
import type { DbClient } from "./db/index.js";
import {
  createDbIndicator,
  createHealthController,
  createHealthService,
} from "../modules/health/index.js";

/**
 * The composition root (ADR-0009).
 *
 * Everything is built once, here, in dependency order, by calling the module
 * factories — no DI container, no decorators, no service locator. Reading this
 * file top to bottom tells you the whole dependency graph of the process, and
 * `createApp` needs nothing but the object it returns.
 *
 * Tests build a container against a test database and get the real wiring
 * (ADR-0021); a unit test skips it entirely and calls one `create*Service`
 * with plain-object repositories.
 */
export interface ContainerDeps {
  readonly config: AppConfig;
  /** Already connected and probed by `main.ts` (ADR-0003). */
  readonly db: DbClient;
  readonly logger: Logger;
}

export const buildContainer = ({ config, db, logger }: ContainerDeps) => {
  const health = createHealthService({
    // The database is the only registered indicator in the first deliverable
    // (ADR-0016); a cache or a queue is one more entry in this array.
    indicators: [createDbIndicator(db)],
    config,
  });

  return {
    config,
    db,
    logger,
    services: { health } as const,
    controllers: { health: createHealthController(health) } as const,
  } as const;
};

export type Container = ReturnType<typeof buildContainer>;
