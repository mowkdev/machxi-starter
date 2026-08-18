# `@repo/logger`

pino-based structured logging for the Node side of the monorepo (ADR-0005).
Ships TypeScript source; consumers compile it (ADR-0002). Frontends do not use
this package.

```ts
import { createLogger, shouldPrettyPrint } from "@repo/logger";

const logger = createLogger({
  level: config.log.level, // LOG_LEVEL (ADR-0004)
  name: "api",
  pretty: shouldPrettyPrint({
    nodeEnv: config.env,
    isTty: process.stdout.isTTY === true,
  }),
});
```

| Export                                  | Purpose                                                                 |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `createLogger(opts)`                    | Process-wide logger. `{ level, pretty?, name?, redact?, destination? }` |
| `shouldPrettyPrint({ nodeEnv, isTty })` | Pretty output only in `development` on a terminal                       |
| `defaultRedactPaths`                    | Credential paths pino redacts on every logger                           |
| `Logger`, `LogLevel`                    | Types (`Logger` is `pino.Logger`)                                       |

## Conventions

- **Fields first, static message second**: `logger.info({ userId }, "session revoked")`,
  never a template string. `msg` stays short and constant so lines group.
- **Levels**: `error` for unexpected failures (5xx), `warn` for expected client
  failures worth noticing (auth failures, rate limits), `info` for lifecycle and
  access logs, `debug` for developer detail.
- **Errors** go under `err` (`logger.error({ err }, "…")`) so pino serialises the
  stack.
- **Never `console.*`** — `no-console` is an error in `@repo/eslint-config`.
- Request-scoped loggers are children of this one, bound with `{ requestId }`
  (and the principal after authentication) by the API context middleware
  (ADR-0010); services read them from `ctx.logger`.

## Redaction

`defaultRedactPaths` covers `authorization`/`cookie` request headers and
`password`, `passwordHash`, `accessToken`, `refreshToken`, `token` — both at the
top level and one level deep, so neither `logger.info({ password })` nor
`logger.info({ body })` can leak a credential. The `redact` option _adds_ paths;
it never replaces the defaults.
