import { pino } from "pino";
import type { DestinationStream, Logger, LoggerOptions } from "pino";

export type { Logger } from "pino";

/**
 * Log levels accepted by {@link createLogger}. `silent` is not part of the
 * `LOG_LEVEL` env enum (ADR-0004) but is useful for tests.
 */
export type LogLevel =
  "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

/**
 * Paths pino redacts on every logger (ADR-0005). Both the top-level key and
 * the one-level-nested form are listed so that neither `log.info({ password })`
 * nor `log.info({ body })` can leak a credential.
 *
 * `refreshTokenHash` / `previousRefreshTokenHash` are the `sessions` column
 * names (ADR-0018) and need their own entries: pino matches redact paths by
 * exact key, so `refreshToken` does not cover them. `tokenHash` is the same
 * fact for the two other credential columns in the schema —
 * `impersonation_handoffs.token_hash` (ADR-0057 §2) and
 * `organization_invitations.token_hash` (ADR-0067 §2) — and neither
 * `refreshTokenHash` nor `token` covers it. Note that redaction does not reach
 * pino's `err` serialiser — never build an error message containing a
 * credential or digest.
 */
export const defaultRedactPaths: readonly string[] = [
  "req.headers.authorization",
  "req.headers.cookie",
  "password",
  // Exact-key matching is why these two are listed at all: `changePasswordBody`
  // (ADR-0018) names its fields `currentPassword` / `newPassword`, and
  // `password` does not cover either of them.
  "currentPassword",
  "newPassword",
  "passwordHash",
  "refreshToken",
  "accessToken",
  "token",
  "refreshTokenHash",
  "previousRefreshTokenHash",
  "tokenHash",
  "*.password",
  "*.currentPassword",
  "*.newPassword",
  "*.passwordHash",
  "*.refreshToken",
  "*.accessToken",
  "*.token",
  "*.refreshTokenHash",
  "*.previousRefreshTokenHash",
  "*.tokenHash",
];

export interface CreateLoggerOptions {
  /** Minimum level to emit. */
  level: LogLevel;
  /**
   * Render human-readable output through `pino-pretty` instead of NDJSON.
   * Resolve it with {@link shouldPrettyPrint} — never hard-code `true`.
   * Ignored when `destination` is set (pino cannot combine a transport with
   * an explicit stream).
   */
  pretty?: boolean;
  /** Emitted as the `name` field on every line, e.g. `api`. */
  name?: string;
  /** Extra redaction paths, merged with {@link defaultRedactPaths}. */
  redact?: readonly string[];
  /** Write target; defaults to stdout. Mainly a test seam. */
  destination?: DestinationStream;
}

/**
 * Pretty printing is for local development only (ADR-0005): it is enabled when
 * the process runs in `development` **and** stdout is a terminal, so piped or
 * containerised output stays machine-parsable. `NODE_ENV` is read by
 * `core/config` (ADR-0004) and handed in here.
 */
export const shouldPrettyPrint = (input: {
  nodeEnv: string;
  isTty: boolean;
}): boolean => input.nodeEnv === "development" && input.isTty;

/**
 * Builds the process-wide logger. Request-scoped loggers are children of this
 * one, bound with `{ requestId }` by the context middleware (ADR-0010).
 */
export const createLogger = ({
  level,
  pretty = false,
  name,
  redact = [],
  destination,
}: CreateLoggerOptions): Logger => {
  const options: LoggerOptions = {
    level,
    redact: [...new Set([...defaultRedactPaths, ...redact])],
    ...(name === undefined ? {} : { name }),
    ...(pretty && destination === undefined
      ? {
          transport: {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "SYS:HH:MM:ss.l",
              ignore: "pid,hostname",
            },
          },
        }
      : {}),
  };

  return destination === undefined ? pino(options) : pino(options, destination);
};
