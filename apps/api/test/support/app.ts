import { createLogger, type Logger } from "@repo/logger";
import type { Express } from "express";

import { createApp } from "../../src/app.js";
import { loadConfig, type AppConfig } from "../../src/core/config/index.js";
import { buildContainer, type Container } from "../../src/core/container.js";
import { createDb, type DbClient } from "../../src/core/db/index.js";

/**
 * Builds a real app against the test database (ADR-0021).
 *
 * The whole point is that nothing is stubbed: the same `loadConfig`,
 * `buildContainer` and `createApp` the process uses, so the middleware order,
 * the envelope and the error mapping are exercised as deployed. Only the
 * logger is silenced and the port is never bound.
 */

export interface TestApp {
  readonly app: Express;
  readonly container: Container;
  readonly config: AppConfig;
  readonly db: DbClient;
  readonly logger: Logger;
  readonly close: () => Promise<void>;
}

export interface CreateTestAppOptions {
  /**
   * Overrides applied to the parsed config — e.g. a database URL pointing at
   * a port nothing listens on, to prove readiness answers 503.
   */
  readonly config?: (config: AppConfig) => AppConfig;
}

export const createTestApp = ({
  config: override,
}: CreateTestAppOptions = {}): TestApp => {
  const config = override ? override(loadConfig()) : loadConfig();

  const logger = createLogger({ level: "silent", name: "api-test" });
  // Two connections and a short idle timeout: a test file opens a client per
  // app and must not hold the pool open past its own lifetime.
  const db = createDb(config.db.url, { max: 2, idleTimeout: 1 });
  const container = buildContainer({ config, db, logger });

  return {
    app: createApp(container),
    container,
    config,
    db,
    logger,
    close: db.close,
  } as const;
};
