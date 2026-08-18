import { createLogger, shouldPrettyPrint } from "@repo/logger";

import { createApp } from "./app.js";
import { loadConfig } from "./core/config/index.js";
import { buildContainer } from "./core/container.js";
import { createDb, probeDatabase } from "./core/db/index.js";
import { startServer } from "./server.js";

/**
 * Process entry point (ADR-0003).
 *
 * The order is the decision: configuration is validated before anything is
 * created, the database is proven reachable before the port is bound, and the
 * signal handlers are installed before the process can receive one. Every step
 * that can fail exits non-zero with a single readable line — a container that
 * crashes loudly is a deployment that stops, and one that starts half-working
 * is an outage nobody notices.
 */

const SIGNALS = ["SIGINT", "SIGTERM"] as const;

/**
 * Reports a startup failure before the logger exists.
 *
 * `no-console` is on everywhere (ADR-0005) and there is genuinely no logger yet
 * when configuration is the thing that failed, so this writes to stderr
 * directly — the same approach `@repo/db`'s CLI scripts take.
 */
const reportFatal = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

const main = async (): Promise<void> => {
  const config = loadConfig();

  const logger = createLogger({
    level: config.log.level,
    name: "api",
    pretty: shouldPrettyPrint({
      nodeEnv: config.env,
      isTty: process.stdout.isTTY === true,
    }),
  });

  const db = createDb(config.db.url, { max: config.db.poolMax });

  try {
    await probeDatabase({
      ping: db.ping,
      attempts: config.db.connectRetries,
      logger,
    });
  } catch (error) {
    logger.fatal({ err: error }, "database unreachable, refusing to start");
    await db.close();

    // The driver's error goes to the log line above, where the stack and the
    // `cause` chain are useful. What reaches stderr is a sentence, because a
    // deploy log that ends in `Failed query: select 1` does not tell an
    // operator that the API never started or why (ADR-0021 acceptance step 3).
    // It names no host and no credential — the log line has the detail.
    throw new Error(
      `Database unreachable after ${String(config.db.connectRetries)} attempt(s); refusing to start. See the preceding log line for the driver error.`,
    );
  }

  const container = buildContainer({ config, db, logger });
  const { shutdown } = startServer({
    app: createApp(container),
    port: config.http.port,
    logger,
    onShutdown: db.close,
  });

  for (const signal of SIGNALS) {
    process.once(signal, () => {
      void shutdown(signal).then(
        () => {
          process.exit(0);
        },
        (error: unknown) => {
          logger.error({ err: error }, "shutdown failed");
          process.exit(1);
        },
      );
    });
  }

  logger.info({ env: config.env, version: config.app.version }, "api started");
};

try {
  await main();
} catch (error) {
  // The message, not the stack: a configuration report lists offending keys,
  // and a driver error can carry the connection string in its stack frames.
  reportFatal(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
