import type { Argon2Params } from "@repo/crypto";
import type { LogLevel } from "@repo/logger";
import { z } from "zod";

import { envSchema, type Env } from "./schema.js";
import { toTrustProxy, type TrustProxy } from "./trust-proxy.js";

/**
 * Loading and grouping of the process configuration (ADR-0004).
 *
 * `process.env` is read here and nowhere else in `apps/api` — the
 * `no-restricted-properties` rule (ADR-0002) exempts this directory and no
 * other — and the result is a frozen,
 * grouped object handed to the container (ADR-0009). Nothing downstream can
 * reach an unvalidated value or a variable this schema does not declare.
 */

export interface AppConfig {
  readonly env: Env["NODE_ENV"];
  readonly isProduction: boolean;
  readonly isDevelopment: boolean;
  readonly isTest: boolean;
  readonly app: {
    /**
     * The brand every derived name reads (ADR-0064 §1): both cookie families
     * and the JWT audience. A fork-day value, defaulting to `machxi`.
     */
    readonly id: string;
    /** The image's `APP_VERSION`, or `dev` when the build set none (ADR-0081 §1). */
    readonly version: string;
    /** Absent unless the build injected a non-empty `GIT_SHA` (ADR-0081 §1). */
    readonly commit?: string;
  };
  readonly http: {
    readonly port: number;
    readonly corsOrigins: readonly string[];
    readonly trustProxy: TrustProxy;
    /**
     * The three socket deadlines `startServer` sets, in seconds (ADR-0073 §4).
     *
     * Grouped with the port because they are properties of this process's
     * listener rather than of a flow: what a client may take to send a whole
     * request, to send its headers, and how long an idle connection is kept —
     * the last deliberately above a typical proxy's sixty seconds, so the
     * proxy is always the end that closes.
     */
    readonly requestTimeoutSec: number;
    readonly headersTimeoutSec: number;
    readonly keepAliveTimeoutSec: number;
  };
  readonly db: {
    readonly url: string;
    readonly poolMax: number;
    readonly connectRetries: number;
    /** `statement_timeout` in milliseconds; `0` disables (ADR-0061 §3). */
    readonly statementTimeoutMs: number;
    /** `idle_in_transaction_session_timeout` in milliseconds; `0` disables. */
    readonly idleTransactionTimeoutMs: number;
    /** What `pg_stat_activity` shows for this process's sessions. */
    readonly applicationName: string;
    /** `false` behind a transaction-mode pooler. */
    readonly preparedStatements: boolean;
  };
  readonly auth: {
    readonly issuer: string;
    readonly accessSecret: string;
    /**
     * `JWT_ACCESS_SECRET_PREVIOUS` — verified for tokens that name it while a
     * rotation is in flight, never signed with (ADR-0078 §2).
     */
    readonly previousAccessSecret: string | undefined;
    /** Access-token lifetime in seconds, parsed from `JWT_ACCESS_TTL`. */
    readonly accessTtlSec: number;
    /** Refresh-token lifetime in seconds, parsed from `REFRESH_TOKEN_TTL`. */
    readonly refreshTtlSec: number;
    readonly refreshRotationGraceSec: number;
    readonly maxConcurrentHashes: number;
    /**
     * How many live sessions one principal may hold; `0` is uncapped
     * (ADR-0073 §3). A mint beyond it revokes the oldest, never the new one.
     */
    readonly maxSessionsPerPrincipal: number;
    readonly argon2: Argon2Params;
    /**
     * The fixed lifetime of an impersonated session, in seconds, parsed from
     * `IMPERSONATION_SESSION_TTL` (ADR-0057 §4). Rotation does not extend it.
     */
    readonly impersonationSessionTtlSec: number;
    /**
     * How long a one-time handoff token stays redeemable, in seconds, parsed
     * from `IMPERSONATION_HANDOFF_TTL` (ADR-0057 §2).
     */
    readonly impersonationHandoffTtlSec: number;
  };
  /**
   * Where each SPA answers, so the API can build the links it mails
   * (ADR-0071 §1).
   *
   * Grouped as `apps` rather than folded into `http`: these are not this
   * process's own listening address, they are two other origins it composes
   * URLs for. `http.corsOrigins` is the allow-list of who may call in; this is
   * where a message points somebody back to.
   */
  readonly apps: {
    readonly customerUrl: string;
    readonly adminUrl: string;
  };
  /**
   * Every `account_tokens` lifetime, in seconds — the four link lifetimes
   * (ADR-0071 §1) and the federated sign-in handoff (ADR-0072 §2), which is
   * the same table's mechanism with no message around it.
   */
  readonly tokens: {
    readonly verificationTtlSec: number;
    readonly passwordResetTtlSec: number;
    readonly emailChangeTtlSec: number;
    readonly staffOnboardingTtlSec: number;
    readonly federatedHandoffTtlSec: number;
  };
  /**
   * Sign-in through an external identity provider (ADR-0072 §2).
   *
   * `google` is **present only when both halves of the client are set**, and
   * that presence is the whole of the routes' precondition: nothing checks a
   * flag beside it, so there is no way to mount the flow without a client or
   * to hold a client without the flow. The schema refuses half a pair, so
   * `undefined` here always means "neither was set".
   */
  readonly federated: {
    /**
     * This API's public origin; the redirect URI is composed from it and
     * stated once, in `docs/deploy.md`, for the provider's console.
     */
    readonly apiPublicUrl: string;
    /**
     * `OIDC_TRANSACTION_SECRET`, or `undefined` for the key derived from the
     * access secret (ADR-0078 §2) — resolved by `oidcTransactionSecret` in
     * `core/oidc`, never by reading `auth.accessSecret` in its place.
     */
    readonly transactionSecret: string | undefined;
    readonly google:
      | {
          readonly clientId: string;
          readonly clientSecret: string;
        }
      | undefined;
  };
  /** Organizations and their invitations (ADR-0067). */
  readonly organizations: {
    /**
     * How long an invitation stays acceptable, in seconds, parsed from
     * `ORGANIZATION_INVITATION_TTL` (ADR-0067 §2).
     */
    readonly invitationTtlSec: number;
  };
  readonly rateLimit: {
    readonly globalMax: number;
    readonly loginMax: number;
    readonly refreshMax: number;
    /** Per window, keyed on the minting staff member's id (ADR-0057 §1). */
    readonly impersonationMax: number;
    /**
     * Per {@link passwordResetWindowSec}, keyed on address and email
     * (ADR-0071 §4) — the one limiter whose window is its own rather than the
     * shared fifteen minutes of `RATE_LIMIT_WINDOW_MS`.
     */
    readonly passwordResetMax: number;
    /**
     * That window, in seconds. Carried beside the count because the count
     * means nothing without it: every other limiter here is per the module's
     * fixed fifteen minutes, so a limiter built from `passwordResetMax` alone
     * would deploy four times the budget ADR-0071 §4 decided.
     */
    readonly passwordResetWindowSec: number;
    /**
     * Per the same window, keyed on the **mailbox alone** (ADR-0071 §4,
     * amended at `D18.5`) — what bounds the messages one address receives from
     * everybody, where {@link passwordResetMax} bounds what it receives from
     * any one source.
     */
    readonly mailboxMax: number;
    /**
     * Per the same window, keyed on the **source address alone** (ADR-0071 §4,
     * amended at `D18.7`) — what bounds one source's total outbound mail to
     * strangers, where the two above both vary with the address the request
     * names and so cannot see a walk across distinct mailboxes.
     */
    readonly mailSourceMax: number;
    /**
     * Per {@link principalHashWindowSec}, keyed on **`ctx.principal.id`**
     * (ADR-0073 §1) — the budget on the authenticated routes that spend an
     * argon2 operation, which is the fifth category ADR-0020 §Residual risks
     * reserved and the only one here whose key is an account rather than an
     * address or a mailbox.
     */
    readonly principalHashMax: number;
    /**
     * That window, in seconds — the shared fifteen minutes, carried beside the
     * count for {@link passwordResetWindowSec}'s reason.
     */
    readonly principalHashWindowSec: number;
    /**
     * Where the counters live (ADR-0066 §4). `undefined` is the in-memory
     * store, which counts per process; a URL makes one budget out of N
     * instances. None of the limits above change with it.
     */
    readonly redisUrl: string | undefined;
  };
  /** The mail port's transport and its settings (ADR-0066 §1). */
  readonly mail: {
    readonly transport: "log" | "smtp";
    /** The envelope sender; a deployment's fact, never a caller's. */
    readonly from: string;
    /** Read only when `transport` is `"smtp"`; defaults are Mailpit's. */
    readonly smtp: {
      readonly host: string;
      readonly port: number;
      readonly secure: boolean;
      readonly user: string | undefined;
      readonly password: string | undefined;
    };
  };
  readonly metrics: {
    /**
     * `undefined` leaves `GET /metrics` unauthenticated, which the schema
     * permits outside production only (ADR-0066 §2).
     */
    readonly token: string | undefined;
  };
  readonly reporting: {
    /** `undefined` builds no reporter and evaluates no adapter (ADR-0066 §3). */
    readonly dsn: string | undefined;
  };
  readonly features: {
    readonly userRegistration: boolean;
  };
  readonly log: {
    readonly level: LogLevel;
  };
}

/**
 * Groups a validated environment into the shape the application consumes.
 *
 * Exported separately from {@link loadConfig} so tests can build a config from
 * a literal without touching process globals (ADR-0021).
 */
export const toAppConfig = (env: Env): AppConfig =>
  Object.freeze({
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === "production",
    isDevelopment: env.NODE_ENV === "development",
    isTest: env.NODE_ENV === "test",
    app: Object.freeze({
      id: env.APP_ID,
      version: env.APP_VERSION,
      ...(env.GIT_SHA === undefined ? {} : { commit: env.GIT_SHA }),
    }),
    http: Object.freeze({
      port: env.PORT,
      corsOrigins: Object.freeze(env.CORS_ORIGINS),
      trustProxy: toTrustProxy(env.TRUST_PROXY),
      requestTimeoutSec: env.HTTP_REQUEST_TIMEOUT,
      headersTimeoutSec: env.HTTP_HEADERS_TIMEOUT,
      keepAliveTimeoutSec: env.HTTP_KEEP_ALIVE_TIMEOUT,
    }),
    db: Object.freeze({
      url: env.DATABASE_URL,
      poolMax: env.DB_POOL_MAX,
      connectRetries: env.DB_CONNECT_RETRIES,
      statementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
      idleTransactionTimeoutMs: env.DB_IDLE_TX_TIMEOUT_MS,
      applicationName: env.DB_APPLICATION_NAME,
      preparedStatements: env.DB_PREPARED_STATEMENTS,
    }),
    auth: Object.freeze({
      issuer: env.JWT_ISSUER,
      accessSecret: env.JWT_ACCESS_SECRET,
      previousAccessSecret: env.JWT_ACCESS_SECRET_PREVIOUS,
      accessTtlSec: env.JWT_ACCESS_TTL,
      refreshTtlSec: env.REFRESH_TOKEN_TTL,
      refreshRotationGraceSec: env.REFRESH_ROTATION_GRACE_SEC,
      maxConcurrentHashes: env.AUTH_MAX_CONCURRENT_HASHES,
      maxSessionsPerPrincipal: env.AUTH_MAX_SESSIONS_PER_PRINCIPAL,
      argon2: Object.freeze({
        memoryKib: env.ARGON2_MEMORY_KIB,
        timeCost: env.ARGON2_TIME_COST,
        parallelism: env.ARGON2_PARALLELISM,
      }),
      impersonationSessionTtlSec: env.IMPERSONATION_SESSION_TTL,
      impersonationHandoffTtlSec: env.IMPERSONATION_HANDOFF_TTL,
    }),
    apps: Object.freeze({
      customerUrl: env.CUSTOMER_APP_URL,
      adminUrl: env.ADMIN_APP_URL,
    }),
    tokens: Object.freeze({
      verificationTtlSec: env.VERIFICATION_TOKEN_TTL,
      passwordResetTtlSec: env.PASSWORD_RESET_TOKEN_TTL,
      emailChangeTtlSec: env.EMAIL_CHANGE_TOKEN_TTL,
      staffOnboardingTtlSec: env.STAFF_ONBOARDING_TOKEN_TTL,
      federatedHandoffTtlSec: env.FEDERATED_HANDOFF_TTL,
    }),
    federated: Object.freeze({
      apiPublicUrl: env.API_PUBLIC_URL,
      transactionSecret: env.OIDC_TRANSACTION_SECRET,
      // Both or neither is the schema's refinement; the conjunction is
      // restated here so the type follows the rule rather than trusting it.
      google:
        env.GOOGLE_CLIENT_ID !== undefined &&
        env.GOOGLE_CLIENT_SECRET !== undefined
          ? Object.freeze({
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            })
          : undefined,
    }),
    organizations: Object.freeze({
      invitationTtlSec: env.ORGANIZATION_INVITATION_TTL,
    }),
    rateLimit: Object.freeze({
      globalMax: env.RATE_LIMIT_GLOBAL_MAX,
      loginMax: env.RATE_LIMIT_LOGIN_MAX,
      refreshMax: env.RATE_LIMIT_REFRESH_MAX,
      impersonationMax: env.RATE_LIMIT_IMPERSONATION_MAX,
      passwordResetMax: env.RATE_LIMIT_PASSWORD_RESET_MAX,
      passwordResetWindowSec: env.RATE_LIMIT_PASSWORD_RESET_WINDOW,
      mailboxMax: env.RATE_LIMIT_MAILBOX_MAX,
      mailSourceMax: env.RATE_LIMIT_MAIL_SOURCE_MAX,
      principalHashMax: env.RATE_LIMIT_PRINCIPAL_HASH_MAX,
      principalHashWindowSec: env.RATE_LIMIT_PRINCIPAL_HASH_WINDOW,
      redisUrl: env.REDIS_URL,
    }),
    mail: Object.freeze({
      // The one place the "unstated means log" reading lives (ADR-0066 §1).
      // The schema keeps `MAIL_TRANSPORT` optional so that production can be
      // made to state it; every other environment gets the default here.
      transport: env.MAIL_TRANSPORT ?? "log",
      from: env.MAIL_FROM,
      smtp: Object.freeze({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        user: env.SMTP_USER,
        password: env.SMTP_PASSWORD,
      }),
    }),
    metrics: Object.freeze({
      token: env.METRICS_TOKEN,
    }),
    reporting: Object.freeze({
      dsn: env.ERROR_REPORTING_DSN,
    }),
    features: Object.freeze({
      userRegistration: env.FEATURE_USER_REGISTRATION,
    }),
    log: Object.freeze({
      level: env.LOG_LEVEL,
    }),
  });

/**
 * Renders a `ZodError` as one line per offending variable.
 *
 * **Keys only, never values** (ADR-0004): the offending value is very often a
 * secret, and this report is written to stderr where a CI job or a container
 * log will keep it. zod's own `message` is safe — it describes the constraint,
 * not the input.
 */
export const formatConfigIssues = (error: z.ZodError): string[] =>
  error.issues.map((issue) => {
    const key = issue.path.join(".");

    return key === "" ? issue.message : `${key}: ${issue.message}`;
  });

/**
 * Parses and groups the environment, or throws with every offending key.
 *
 * `source` defaults to `process.env`; tests pass a literal record so they never
 * mutate process globals (ADR-0021). The thrown message lists keys and
 * constraints only, and `main.ts` prints it before the logger exists.
 */
export const loadConfig = (
  source: Record<string, string | undefined> = process.env,
): AppConfig => {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const issues = formatConfigIssues(parsed.error);

    // A plain `Error`, not a new error type: ADR-0013 allows exactly one
    // (`AppError`), and this failure happens before the HTTP layer exists —
    // there is no status to map it to, only a non-zero exit (ADR-0004).
    throw new Error(
      `Invalid environment (${String(issues.length)} problem${issues.length === 1 ? "" : "s"}):\n  ${issues.join("\n  ")}`,
    );
  }

  return toAppConfig(parsed.data);
};
