# ADR-0005: Structured logging with pino

- Status: accepted
- Date: 2026-08-17

## Context

The starter has `@repo/logger` wrapping `console.log` and `morgan("dev")` for HTTP access logs. Neither is structured, leveled, redacting or correlatable by request. An enterprise API needs JSON logs with request ids, consistent fields, and a way to bind context (request id, user id) without threading a logger through every call.

## Decision

### Scope

**Added 2026-08-18 (step 6).** This ADR governs **long-running processes** — the API and anything else that serves requests. One-shot CLI scripts are out of scope: the `db:*` scripts (ADR-0008) are run by a person watching the terminal or by a deploy job capturing stdout, and a migration log is worse as JSON than as a line. They write plain lines through small `writeLine` / `writeErrorLine` helpers (`packages/db/src/tooling/report.ts`). Two rules still bind them: `no-console` stays on everywhere, so the helpers write to `process.stdout` / `process.stderr` directly; and the redaction rule below applies in spirit — a `db:*` script prints `host:port/database`, never a connection string (ADR-0008 §Environment guardrails). `@repo/db` may not depend on `@repo/logger` in any case, because ADR-0002 limits it to `@repo/contracts` and `@repo/crypto`.

- **pino** as the logger. `@repo/logger` is rewritten to export a factory and types:

```ts
// packages/logger/src/index.ts
export type Logger = pino.Logger;
export type LogLevel = 'fatal'|'error'|'warn'|'info'|'debug'|'trace'|'silent';
export function createLogger(opts: {
  level: LogLevel; pretty?: boolean; name?: string;
  redact?: readonly string[];        // added to the defaults, never replacing them
  destination?: DestinationStream;   // defaults to stdout; test seam
}): Logger
export function shouldPrettyPrint(input: { nodeEnv: string; isTty: boolean }): boolean
export const defaultRedactPaths = [
  'req.headers.authorization', 'req.headers.cookie',
  'password', 'passwordHash', 'refreshToken', 'accessToken', 'token',
  'refreshTokenHash', 'previousRefreshTokenHash',          // added 2026-08-18
  '*.password', '*.passwordHash', '*.refreshToken', '*.accessToken', '*.token',
  '*.refreshTokenHash', '*.previousRefreshTokenHash',
];
```

`silent` is a factory-only level (tests); the `LOG_LEVEL` env enum (ADR-0004) stays at the six real levels.

`pino-pretty` is a dev dependency of `@repo/logger`: it is only reachable through the `development` branch of `shouldPrettyPrint()`, so production installs do not carry it. An explicit `destination` takes precedence over `pretty` — pino cannot combine a transport with a passed stream.

Pretty printing (`pino-pretty`) is enabled only when `NODE_ENV=development` and stdout is a TTY. That rule is the `shouldPrettyPrint()` predicate: `NODE_ENV` is read by `core/config` (ADR-0004) and the resolved boolean is handed to `createLogger`, so the logger package never touches `process.env`. Everything else emits newline-delimited JSON.

- **HTTP access logging** via `pino-http`, mounted first in the middleware chain (ADR-0011). It:
  - generates the request id (UUIDv7) or honours an inbound `X-Request-Id` only if it matches `^[A-Za-z0-9_-]{8,64}$` (otherwise it is replaced) — stored on the request context (ADR-0010) and echoed in the response header;
  - logs one line per request at completion: method, url, statusCode, responseTime, requestId, and `principal` (population + id) when authenticated;
  - uses level by status: `< 400` info, `4xx` warn, `5xx` error;
  - skips `/health/*` at info level (logged at debug only) to keep noise down.

**Amended 2026-08-18 (step 7).** The access line is built from **explicit
serialisers** that emit exactly the fields listed above (`req: { id, method, url }`,
`res: { statusCode }`, plus `responseTime` and the principal), not from pino's
defaults. The defaults dump every request and response header, which is both
noise and a standing obligation: the redact list would have to keep pace with
every header that might one day carry a credential, and a header nobody thought
about is logged by default. Naming the fields inverts that — a new header is not
logged unless someone adds it here — and it is why the `req.headers.*` redact
paths, which still apply to anything that logs a request object deliberately, are
no longer what protects the access log.

The URL those serialisers and the level rule read is **`req.originalUrl`**, not
`req.url`. Express rewrites `req.url` to the mount-relative path while a
sub-router dispatches (`/health/ready` becomes `/ready`) and restores it when the
stack unwinds, so a handler that responds asynchronously completes at a moment
when the stripped form may still be in place. Keying the "health checks log at
debug" rule on `req.url` made it work or not depending on whether the route
happened to await something — which is exactly the kind of failure that does not
show up in a unit test of the rule itself.

- **Context-bound logger**: the request context (ADR-0010) carries a child logger pre-bound with `{ requestId }` (and later `{ principalId, population }`). Services and repositories obtain it from the context rather than importing a global — this is what makes logs correlate without argument threading.

- **Field conventions**: `msg` is a short, static, human-readable string; variable data goes in fields (`log.info({ userId, sessionId }, 'session revoked')`, not template strings). Errors are logged with `err` so pino serialises stack traces.

- **Levels**: `error` for unexpected failures (5xx), `warn` for expected client-side failures worth noticing (auth failures, rate limits), `info` for lifecycle and access logs, `debug` for developer detail. Default `LOG_LEVEL=info`, `debug` in local `.env.example`.

- **Redaction** is applied at the logger level via pino `redact` (paths above). Each credential key is listed both at the top level and one level deep, so neither a careless `log.info({ body })` nor `log.info({ password })` can leak a secret. The `redact` option adds paths; it cannot remove a default.

- **Session token hashes are redacted too** (amended 2026-08-18). `refreshTokenHash` and `previousRefreshTokenHash` are the `sessions` column names (ADR-0018), and pino matches redact paths by exact key — `refreshToken` does **not** cover `refreshTokenHash`. A SHA-256 digest is not directly usable as a credential, but it is the lookup key for a live session, so it stays out of logs. Anything that logs a session row (`log.debug({ session })`) is covered by the one-level-deep form.

- **Redaction does not reach `err`.** pino's error serialiser is not path-redacted, so a third-party exception that interpolates a secret into its `message` would be logged in full — and echoed to the client in `error.debug` under `NODE_ENV=development` (ADR-0013). The rule is therefore upstream: **never construct an error message containing a credential, digest or token**, and prefer wrapping a third-party error over rethrowing it when its message may embed input. `@repo/crypto` follows this — it never throws with the digest or password in the message.

## Consequences

- Log lines are machine-parsable and correlate by `requestId`; ready for Loki/ELK/Datadog without changes.
- `morgan` and the console logger are removed. `@repo/logger` is Node-only (pino), so `apps/web` no longer depends on it; browser-side logging is out of scope.
- Slight learning curve: "message first, fields second" discipline.

## Alternatives considered

- `winston`: heavier, slower, less opinionated about JSON.
- Keeping `morgan` + console: not structured, no correlation, no redaction.
- OpenTelemetry logs from day one: overkill for the first deliverable; pino integrates later via `pino-opentelemetry-transport`.
