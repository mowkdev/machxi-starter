# ADR-0005: Structured logging with pino

- Status: accepted
- Date: 2026-08-17

## Context

The starter has `@repo/logger` wrapping `console.log` and `morgan("dev")` for HTTP access logs. Neither is structured, leveled, redacting or correlatable by request. An enterprise API needs JSON logs with request ids, consistent fields, and a way to bind context (request id, user id) without threading a logger through every call.

## Decision

- **pino** as the logger. `@repo/logger` is rewritten to export a factory and types:

```ts
// packages/logger/src/index.ts
export type Logger = pino.Logger;
export function createLogger(opts: { level: string; pretty?: boolean; name?: string; redact?: string[] }): Logger
export const defaultRedactPaths = [
  'req.headers.authorization', 'req.headers.cookie',
  '*.password', '*.passwordHash', '*.refreshToken', '*.accessToken', '*.token',
];
```

Pretty printing (`pino-pretty`) is enabled only when `NODE_ENV=development` and stdout is a TTY. Everything else emits newline-delimited JSON.

- **HTTP access logging** via `pino-http`, mounted first in the middleware chain (ADR-0011). It:
  - generates the request id (UUIDv7) or honours an inbound `X-Request-Id` only if it matches `^[A-Za-z0-9_-]{8,64}$` (otherwise it is replaced) — stored on the request context (ADR-0010) and echoed in the response header;
  - logs one line per request at completion: method, url, statusCode, responseTime, requestId, and `principal` (population + id) when authenticated;
  - uses level by status: `< 400` info, `4xx` warn, `5xx` error;
  - skips `/health/*` at info level (logged at debug only) to keep noise down.

- **Context-bound logger**: the request context (ADR-0010) carries a child logger pre-bound with `{ requestId }` (and later `{ principalId, population }`). Services and repositories obtain it from the context rather than importing a global — this is what makes logs correlate without argument threading.

- **Field conventions**: `msg` is a short, static, human-readable string; variable data goes in fields (`log.info({ userId, sessionId }, 'session revoked')`, not template strings). Errors are logged with `err` so pino serialises stack traces.

- **Levels**: `error` for unexpected failures (5xx), `warn` for expected client-side failures worth noticing (auth failures, rate limits), `info` for lifecycle and access logs, `debug` for developer detail. Default `LOG_LEVEL=info`, `debug` in local `.env.example`.

- **Redaction** is applied at the logger level via pino `redact` (paths above), so a careless `log.info({ body })` cannot leak a password.

## Consequences

- Log lines are machine-parsable and correlate by `requestId`; ready for Loki/ELK/Datadog without changes.
- `morgan` and the console logger are removed.
- Slight learning curve: "message first, fields second" discipline.

## Alternatives considered

- `winston`: heavier, slower, less opinionated about JSON.
- Keeping `morgan` + console: not structured, no correlation, no redaction.
- OpenTelemetry logs from day one: overkill for the first deliverable; pino integrates later via `pino-opentelemetry-transport`.
