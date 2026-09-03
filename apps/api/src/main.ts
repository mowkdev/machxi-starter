import { createLogger, shouldPrettyPrint } from "@repo/logger";

import { createApp } from "./app.js";
import { loadConfig } from "./core/config/index.js";
import { buildContainer } from "./core/container.js";
import { createDb, probeDatabase } from "./core/db/index.js";
import { createRateLimitStore } from "./core/rate-limit/index.js";
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

  // Every bound this process's connections carry, from validated config
  // (ADR-0061 §3): the two timeouts and the `pg_stat_activity` name go onto
  // each connection postgres.js opens, and `preparedStatements` is what makes
  // a transaction-mode pooler a configuration change rather than a code one.
  const db = createDb(config.db.url, {
    max: config.db.poolMax,
    statementTimeoutMs: config.db.statementTimeoutMs,
    idleTransactionTimeoutMs: config.db.idleTransactionTimeoutMs,
    applicationName: config.db.applicationName,
    noPreparedStatements: !config.db.preparedStatements,
  });

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

  // After the database probe and before the container, because the limiters
  // are built inside it and a client's `connect` is asynchronous (ADR-0066
  // §4). With no `REDIS_URL` this resolves immediately to the in-memory store
  // and logs which one is in force — "every limit counts per process" is a
  // property of a deployment that an operator should be able to read in the
  // startup lines rather than infer from the absence of a variable.
  //
  // A configured Redis that cannot be reached rejects here, so the process
  // exits rather than starting with limiters that would fail closed on every
  // request: a shared store is a deployment's decision, and half of one is
  // worse than either.
  const rateLimitStore = await createRateLimitStore({
    url: config.rateLimit.redisUrl,
    logger,
  });

  const container = buildContainer({
    config,
    db,
    logger,
    rateLimitStore: rateLimitStore.store,
  });

  // Before the port opens, not after: the dummy password hash has to exist by
  // the time the first login can arrive, or that request pays hash + verify
  // while a known-email login pays verify alone — the timing oracle
  // `dummyHash` exists to close (ADR-0018 §Password hashing).
  await container.warmup();

  const { shutdown } = startServer({
    app: createApp(container),
    port: config.http.port,
    logger,
    // Both, in the order they were opened: in-flight queries finish first,
    // then the rate-limit client goes. `close` is a no-op when there is no
    // Redis.
    onShutdown: async () => {
      await db.close();
      await rateLimitStore.close();
    },
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
