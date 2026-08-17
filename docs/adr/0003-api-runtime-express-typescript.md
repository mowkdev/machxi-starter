# ADR-0003: API runtime — Express 5 on Node 22, TypeScript ESM

- Status: accepted
- Date: 2026-08-17

## Context

The starter API is Express 4.21 with `body-parser`, `morgan`, `cors`, built with `tsdown` to CJS and run with `tsx` in dev. The requirement is an Express-family REST API ("ts express realm") that is scalable and enterprise-grade, with explicit route → controller → service layering (ADR-0009) and no framework magic.

Express 4 has one significant liability for this style: rejected promises in async handlers are not forwarded to error middleware, forcing `asyncHandler` wrappers or `express-async-errors`. Express 5 forwards them natively.

## Decision

- **Express 5** (`express@^5`) with `@types/express@^5`.
- **Node 22 LTS**, native ESM (`"type": "module"`), `NodeNext` module resolution.
- **Dev**: `tsx watch src/main.ts` with `.env` loading (ADR-0004).
- **Build**: `tsdown` bundling `src/main.ts` to a single ESM file `dist/main.js` (not CJS as in the starter — CJS is not needed and complicates ESM-only deps such as `pino` transports and `zod` v4).
- **Start**: `node dist/main.js`.
- Body parsing via built-ins `express.json()` / `express.urlencoded()`; `body-parser` and `morgan` are removed (logging per ADR-0005).
- Application composition is explicit:

```
apps/api/src/
├── main.ts              # process entry: load config, connect db, start http, handle signals
├── app.ts               # createApp(deps): builds and returns the Express app (no listen)
├── server.ts            # startServer(app, config): listen, graceful shutdown
├── core/                # cross-cutting: config, context, errors, http (envelope), middleware, logger, db handle
├── modules/             # feature modules (ADR-0009)
└── routes/              # top-level routers per segment (ADR-0015)
```

`createApp` receives its dependencies (db, logger, config) as arguments so tests can build an app against a test database without touching process globals (ADR-0021).

- **Startup sequence** (`main.ts`):
  1. parse and validate config (fail fast, ADR-0004);
  2. create logger;
  3. create db client and run a connectivity probe (`SELECT 1`) with a bounded retry (e.g. 10 attempts × 1 s) — the process exits non-zero if the database is unreachable (hard dependency, ADR-0006);
  4. `createApp` → `startServer`;
  5. register `SIGINT`/`SIGTERM` handlers: stop accepting connections, drain in-flight requests (timeout 10 s), close db pool, exit.

## Consequences

- No async wrapper boilerplate; a thrown `AppError` in a controller reaches the error middleware (ADR-0013).
- Express 5 differences to remember: `req.query` is a getter (read-only), path-to-regexp v8 syntax (`/:id`, `{/optional}`, no bare `*`), `res.redirect('back')` removed, `app.del` removed.
- Single-file ESM bundle keeps the runtime image small and start-up simple.

## Alternatives considered

- **Fastify**: faster, schema-first, but not "express realm"; less familiar to the target audience.
- **NestJS**: strong opinions and DI out of the box, but heavy, decorator-driven and hides the request pipeline; the goal here is an explicit, readable pattern.
- **Express 4 + `express-async-errors`**: works, but Express 5 is stable and removes the need for a monkey-patch.
