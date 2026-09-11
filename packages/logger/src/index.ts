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
 * `refreshTokenHash` nor `token` covers it.
 *
 * `payload` and `newEmail` join them for `account_tokens` (ADR-0071 §1, §6).
 * Neither is a credential, and both are redacted anyway: the payload column
 * carries the address a change-of-address is *about to* move to, which is a
 * fact about a person that has not happened yet and that the old mailbox has
 * not been told about — and a log line is the one place it would be kept after
 * the token is spent. `newEmail` is the request body's name for the same
 * value, so a controller that logged its input would print it under the other
 * spelling.
 *
 * **`payload` is a deliberately broad key**, and worth knowing before somebody
 * "fixes" it: it blanks *any* field called `payload` on any logger in this
 * monorepo — a decoded JWT body logged while debugging, for one. That is the
 * safe direction and it is the reason the entry is not narrower; a path like
 * `accountToken.payload` would cover one call site and miss the next.
 *
 * `link` is here **ahead of its use** (`D18.1`'s `security-reviewer`), the way
 * `tokenHash` was: the credential ADR-0071 §1 mints does not travel as a
 * column, it travels as a URL with the raw token in its fragment, and the
 * `log` mail transport writes a line per message. `url` is deliberately **not**
 * listed — `*.url` would blank `req.url` on every request log line in the
 * repository, trading the whole observability of the HTTP layer for one
 * hypothetical field name. The rule for `core/mail` is the one this docblock
 * has always ended with: never put a credential in a field this list does not
 * name.
 *
 * `clientSecret`, `codeVerifier` and `idToken` are here ahead of their use too
 * (ADR-0072 §2), for the OIDC flow's three values that must never be written
 * down: the OAuth client's secret, the PKCE verifier that turns an intercepted
 * authorization code into a sign-in, and the provider's signed assertion about
 * a person. The provider port holds all three in camelCase and never logs
 * them; these entries are what keeps a debugging line from doing it instead.
 *
 * Note that redaction does not reach pino's `err` serialiser — never build an
 * error message containing a credential or digest.
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
  "payload",
  "newEmail",
  "link",
  "clientSecret",
  "codeVerifier",
  "idToken",
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
  "*.payload",
  "*.newEmail",
  "*.link",
  "*.clientSecret",
  "*.codeVerifier",
  "*.idToken",
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
