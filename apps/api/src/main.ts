import { createLogger, shouldPrettyPrint } from "@repo/logger";

import { createApp } from "./app.js";
import { loadConfig } from "./core/config/index.js";
import { buildContainer } from "./core/container.js";
import {
  assertRoleBoundByRowLevelSecurity,
  createDb,
  isRowLevelSecurityRefusal,
  probeDatabase,
} from "./core/db/index.js";
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
    // Which is why it carries no `cause`: Node prints an uncaught error's
    // cause chain to stderr, and that chain is the driver error this sentence
    // exists to keep out of it (ESLint 10's `preserve-caught-error`, `D21.2`).
    // eslint-disable-next-line preserve-caught-error -- the cause is logged above, deliberately not rethrown
    throw new Error(
      `Database unreachable after ${String(config.db.connectRetries)} attempt(s); refusing to start. See the preceding log line for the driver error.`,
    );
  }

  // Once the database answers, and before anything is built on it: in
  // production, a role that row-level security does not bind — a superuser,
  // BYPASSRLS, a member of either, or the owner of a table — would keep
  // every request working and isolate no tenant, so the process refuses
  // rather than starts (ADR-0078 §4 as amended at `D29.7`). Development and
  // test are exempt: a local database is the developer's own, and the suite
  // proves the policies against the application role directly.
  if (config.env === "production") {
    try {
      await assertRoleBoundByRowLevelSecurity(db.db);
    } catch (error) {
      // Two failures, two log lines: a refusal is a statement about the role,
      // and a query that failed while asking says nothing about it — both
      // stop the process (the `D29.7` follow-up).
      const refused = isRowLevelSecurityRefusal(error);

      logger.fatal(
        { err: error },
        refused
          ? "database role not bound by row-level security, refusing to start"
          : "could not read the database role's row-level security attributes, refusing to start",
      );
      await db.close();

      if (refused) throw error;

      // A driver error while asking: the sentence reaches stderr, the error
      // the log line above (the same reasoning as the probe's).
      // eslint-disable-next-line preserve-caught-error -- the cause is logged above, deliberately not rethrown
      throw new Error(
        "Could not read the database role's row-level security attributes; refusing to start. See the preceding log line for the driver error.",
      );
    }
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
    // The three socket deadlines beside the drain deadline (ADR-0073 §4).
    // Stated rather than inherited: Node's request and header defaults are a
    // slow-loris budget, and its five-second keep-alive is shorter than the
    // sixty a reverse proxy holds — which is the one that surfaces as
    // intermittent `502`s in front of a healthy process.
    requestTimeoutMs: config.http.requestTimeoutSec * 1000,
    headersTimeoutMs: config.http.headersTimeoutSec * 1000,
    keepAliveTimeoutMs: config.http.keepAliveTimeoutSec * 1000,
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
