import { createArgon2Hasher, type PasswordHasher } from "@repo/crypto";
import { createLogger, type Logger } from "@repo/logger";
import type { Express } from "express";

import { createApp } from "../../src/app.js";
import type { MailMessage, MailSender } from "../../src/core/mail/index.js";
import { loadConfig, type AppConfig } from "../../src/core/config/index.js";
import { buildContainer, type Container } from "../../src/core/container.js";
import {
  createFakeOidcProvider,
  oidcRedirectUri,
  type FakeOidcProvider,
} from "../../src/core/oidc/index.js";
import type { ErrorReporter } from "../../src/core/reporting/index.js";

import { loadTestEnv } from "../setup/env.js";

import {
  createDb,
  type DbClient,
  type DbExecutor,
} from "../../src/core/db/index.js";

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
  /**
   * The seeders' hasher, built from this app's own `config.auth.argon2` — the
   * values the container's hasher is built from — so a seeded password
   * verifies against exactly what the API expects. The container does not
   * expose its own (`D28.6`, `API-12`): a raw hasher on the root's surface is
   * a way around the ADR-0020 cap.
   */
  readonly hasher: PasswordHasher;
  /**
   * Every message this app sent, newest last (ADR-0066 §1, ADR-0071 §3).
   *
   * The suite has to read the **link** a flow mailed, and neither shipped
   * adapter is a place to read it from: the log transport deliberately writes
   * the recipient and the subject and never the body, because that body holds
   * a single-use bearer credential (ADR-0057 §2), and the SMTP one needs a
   * server. So the container is handed a capturing sender — the port's own
   * shape — and everything above it, the templates included, is the real
   * wiring.
   */
  readonly mail: MailMessage[];
  /**
   * The identity provider this app signs in against, when the Google client
   * is configured (ADR-0072 §2) — always the fake, never Google.
   *
   * Handed to the container through its override rather than chosen from
   * configuration, which is the only way the fake can reach the flow
   * (`D19.1`'s `security-reviewer`). `consent` is the person at the
   * provider: it reads the authorization URL a start produced and returns the
   * `code` and `state` the callback would receive.
   */
  readonly oidc: FakeOidcProvider;
  /**
   * Runs `fn` in a transaction on a short-lived **owner** connection — the
   * only way a test reads or writes across tenants (ADR-0083 §1): its own
   * fixtures and assertions on the tenant-owned tables, and the fixtures the
   * application role is not granted at all, such as moving an invitation's
   * `expires_at` into the past (migration `0020` grants it UPDATE on the
   * terminal stamps alone). The owner is bound by no policy and by no column
   * grant. The app itself never goes through this: every request's
   * transactions are scoped by its guards, which is what the integration
   * cases exercise.
   */
  readonly asOwner: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  readonly close: () => Promise<void>;
}

export interface CreateTestAppOptions {
  /**
   * Overrides applied to the parsed config — e.g. a database URL pointing at
   * a port nothing listens on, to prove readiness answers 503.
   */
  readonly config?: (config: AppConfig) => AppConfig;
  /**
   * A stub for the ADR-0066 §3 seam. Supplied instead of a DSN, because what
   * the suite has to prove is *which statuses reach a reporter* — a property
   * of the error handler — and there is nothing to learn from a vendor SDK.
   */
  readonly reporter?: ErrorReporter;
}

export const createTestApp = ({
  config: override,
  reporter,
}: CreateTestAppOptions = {}): TestApp => {
  const config = override ? override(loadConfig()) : loadConfig();

  const logger = createLogger({ level: "silent", name: "api-test" });
  const mail: MailMessage[] = [];
  const mailSender: MailSender = {
    send: (_ctx, message) => {
      mail.push(message);

      return Promise.resolve();
    },
  };
  // Two connections and a short idle timeout: a test file opens a client per
  // app and must not hold the pool open past its own lifetime.
  const db = createDb(config.db.url, { max: 2, idleTimeout: 1 });
  // The fake's client id and redirect URI are the configuration's, so the
  // authorization URL a start returns is the one the real adapter would
  // build for this deployment.
  const oidc = createFakeOidcProvider({
    ...(config.federated.google === undefined
      ? {}
      : { clientId: config.federated.google.clientId }),
    redirectUri: oidcRedirectUri(config.federated.apiPublicUrl),
  });
  const container = buildContainer({
    config,
    db,
    logger,
    // No `rateLimitStore`: the suite always uses the in-memory store, which is
    // what makes a limiter's count local to one app instance (ADR-0066 §4).
    mail: mailSender,
    // Used only when `config.federated.google` is present; a configuration
    // without the client mounts no route and never reaches it.
    oidc: oidc.provider,
    ...(reporter === undefined ? {} : { reporter }),
  });

  return {
    app: createApp(container),
    container,
    config,
    db,
    logger,
    hasher: createArgon2Hasher(config.auth.argon2),
    mail,
    oidc,
    asOwner: async (fn) => {
      const owner = createDb(loadTestEnv().ownerDatabaseUrl, {
        max: 1,
        idleTimeout: 1,
      });

      try {
        return await owner.db.transaction(fn);
      } finally {
        await owner.close();
      }
    },
    close: db.close,
  } as const;
};
