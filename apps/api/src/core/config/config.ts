import type { Argon2Params } from "@repo/crypto";
import type { LogLevel } from "@repo/logger";
import { z } from "zod";

import { envSchema, type Env } from "./schema.js";

/**
 * Loading and grouping of the process configuration (ADR-0004).
 *
 * `process.env` is read here and nowhere else in `apps/api` — the
 * `no-restricted-properties` rule (ADR-0002) exempts this directory and no
 * other — and the result is a frozen,
 * grouped object handed to the container (ADR-0009). Nothing downstream can
 * reach an unvalidated value or a variable this schema does not declare.
 */

/** What Express accepts for its `trust proxy` setting. */
export type TrustProxy = boolean | number | string;

/**
 * Interprets `TRUST_PROXY`. Express itself accepts three forms, so the
 * variable stays a string in the schema and is resolved once, here:
 * `false`/`true`, a hop count, or a value Express parses itself
 * (`loopback`, a CIDR list).
 */
export const toTrustProxy = (raw: string): TrustProxy => {
  const value = raw.trim();

  if (value === "false") return false;
  if (value === "true") return true;

  const hops = Number(value);

  return Number.isInteger(hops) && hops >= 0 ? hops : value;
};

export interface AppConfig {
  readonly env: Env["NODE_ENV"];
  readonly isProduction: boolean;
  readonly isDevelopment: boolean;
  readonly isTest: boolean;
  readonly app: {
    readonly version: string;
    /** Absent unless the build injected `GIT_SHA`. */
    readonly commit?: string;
  };
  readonly http: {
    readonly port: number;
    readonly corsOrigins: readonly string[];
    readonly trustProxy: TrustProxy;
  };
  readonly db: {
    readonly url: string;
    readonly poolMax: number;
    readonly connectRetries: number;
  };
  readonly auth: {
    readonly issuer: string;
    readonly accessSecret: string;
    /** Access-token lifetime in seconds, parsed from `JWT_ACCESS_TTL`. */
    readonly accessTtlSec: number;
    /** Refresh-token lifetime in seconds, parsed from `REFRESH_TOKEN_TTL`. */
    readonly refreshTtlSec: number;
    readonly refreshRotationGraceSec: number;
    readonly maxConcurrentHashes: number;
    readonly argon2: Argon2Params;
  };
  readonly rateLimit: {
    readonly globalMax: number;
    readonly loginMax: number;
    readonly refreshMax: number;
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
      version: env.APP_VERSION,
      ...(env.GIT_SHA === undefined ? {} : { commit: env.GIT_SHA }),
    }),
    http: Object.freeze({
      port: env.PORT,
      corsOrigins: Object.freeze(env.CORS_ORIGINS),
      trustProxy: toTrustProxy(env.TRUST_PROXY),
    }),
    db: Object.freeze({
      url: env.DATABASE_URL,
      poolMax: env.DB_POOL_MAX,
      connectRetries: env.DB_CONNECT_RETRIES,
    }),
    auth: Object.freeze({
      issuer: env.JWT_ISSUER,
      accessSecret: env.JWT_ACCESS_SECRET,
      accessTtlSec: env.JWT_ACCESS_TTL,
      refreshTtlSec: env.REFRESH_TOKEN_TTL,
      refreshRotationGraceSec: env.REFRESH_ROTATION_GRACE_SEC,
      maxConcurrentHashes: env.AUTH_MAX_CONCURRENT_HASHES,
      argon2: Object.freeze({
        memoryKib: env.ARGON2_MEMORY_KIB,
        timeCost: env.ARGON2_TIME_COST,
        parallelism: env.ARGON2_PARALLELISM,
      }),
    }),
    rateLimit: Object.freeze({
      globalMax: env.RATE_LIMIT_GLOBAL_MAX,
      loginMax: env.RATE_LIMIT_LOGIN_MAX,
      refreshMax: env.RATE_LIMIT_REFRESH_MAX,
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
