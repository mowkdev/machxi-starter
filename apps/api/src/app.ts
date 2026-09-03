import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import qs from "qs";

import type { Container } from "./core/container.js";
import {
  createContextMiddleware,
  createErrorHandler,
  createHttpLogger,
  createImpersonationTrail,
  notFoundHandler,
} from "./core/middleware/index.js";
import { createRoutes } from "./routes/index.js";

/**
 * Builds the Express application (ADR-0003, ADR-0011).
 *
 * No `listen` here: `createApp` takes a container and returns an app, so a
 * test can drive the whole middleware chain over supertest against a test
 * database without binding a port or touching process globals (ADR-0021).
 *
 * The middleware order below is the one ADR-0011 fixes, and it is load-bearing
 * in both directions: `pino-http` must be first or a failure in any later
 * middleware is unlogged and uncorrelated; the error handler must be last or it
 * catches nothing.
 */

/** ADR-0020. Per-route overrides come with the first upload endpoint. */
const JSON_BODY_LIMIT = "1mb";

/**
 * Express 5 defaults `query parser` to `simple`, which does not build nested
 * objects: `?filter[status][in]=active` would arrive as the single key
 * `"filter[status][in]"` and every list schema would reject it, so ADR-0014's
 * whole filter syntax depends on this line.
 *
 * The explicit `qs` options rather than the bare `"extended"` string are the
 * ADR-0020 input bound. `depth: 3` is one level deeper than
 * `filter[field][op]` needs, and it is what stops a crafted, deeply nested
 * query string from burning CPU in the parser before any handler runs.
 */
export const queryParser = (raw: string): unknown =>
  qs.parse(raw, { depth: 3, arrayLimit: 20, parameterLimit: 50 });

/** The one `CORS_ORIGINS` entry that is not an origin (ADR-0004, ADR-0020). */
const WILDCARD_ORIGIN = "*";

/**
 * Translates the validated allow-list into what `cors` actually understands
 * (ADR-0020 §CORS).
 *
 * The translation is the point, because the two are not the same language.
 * `cors` compares an array's entries to the `Origin` header **by exact string**,
 * so a literal `"*"` in the array matches no origin that has ever existed:
 * `CORS_ORIGINS=*` used to mean "allow every origin" to whoever set it and
 * "allow none" to the middleware, silently and in the more permissive-looking
 * direction. ADR-0020 says "No `*` in production", which is only a meaningful
 * thing to say if `*` does something everywhere else.
 *
 * `true` rather than the string: `cors` reflects the request's `Origin` back,
 * and reflection is what makes a wildcard work at all alongside
 * `credentials: true` — the CORS specification forbids a literal `*` on a
 * credentialed response, so a browser would reject it. Reflecting any origin
 * on a credentialed API is exactly as open as it sounds, which is why the
 * config schema refuses `*` outright when `NODE_ENV=production` (ADR-0004);
 * that refusal is the control, and this function is only honest about what the
 * value means everywhere else.
 *
 * An empty list stays `false` — "no browser origin is permitted". Non-browser
 * clients are unaffected either way: CORS is enforced by the browser, not here.
 */
export const corsOrigin = (origins: readonly string[]): boolean | string[] => {
  // Before the emptiness check, and before any exact match: a list that
  // contains the wildcard is a wildcard, whatever else it lists.
  if (origins.includes(WILDCARD_ORIGIN)) return true;

  return origins.length === 0 ? false : [...origins];
};

export const createApp = (container: Container): Express => {
  const { config, logger } = container;
  const app = express();

  // Never advertise the framework, and no weak validators on JSON responses
  // (ADR-0020). `trust proxy` decides what `req.ip` means, which the rate
  // limiter and the session audit trail both depend on.
  app.disable("x-powered-by");
  app.disable("etag");
  app.set("trust proxy", config.http.trustProxy);
  app.set("query parser", queryParser);

  app.use(createHttpLogger(logger));
  app.use(createContextMiddleware());

  // Above helmet, CORS and the body parsers, so that everything the process
  // answers is counted — a 429 from the global limiter, a rejected preflight
  // and a 404 included (ADR-0066 §2). It observes on the response's `finish`
  // event and calls `next()` immediately, so it is not a sixth entry in
  // ADR-0011's order any more than the impersonation trail below is: nothing
  // downstream can tell it is there.
  app.use(container.metrics.middleware);

  app.use(helmet());
  app.use(
    cors({
      origin: corsOrigin(config.http.corsOrigins),
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      exposedHeaders: ["X-Request-Id"],
    }),
  );

  app.use(express.json({ limit: JSON_BODY_LIMIT, strict: true }));
  // `extended: false`, which body-parser maps to a flat parse with `depth: 0`
  // and no `allowPrototypes`. `extended: true` would hand form bodies to `qs`
  // with `depth: 32`, `parameterLimit: 1000` and prototype keys allowed —
  // bounds an order of magnitude looser than the query parser above, for a
  // content type this API never consumes (it answers JSON only, ADR-0012).
  // The parser stays mounted so that a form post fails as a validation error
  // rather than as an empty body.
  app.use(express.urlencoded({ extended: false, limit: JSON_BODY_LIMIT }));

  // Immediately above the routes rather than anywhere earlier, which leaves
  // ADR-0011's documented 1–5 prefix exactly as it is: this is not a sixth
  // entry in that order, it is one wrapper around the router. Every route the
  // API has is mounted on the line below, so "no route added later can escape
  // the audit trail" (ADR-0057 §6) holds from here just as it would from the
  // top of the chain — and it costs a `Set` lookup on a read and nothing at
  // all on an ordinary session.
  app.use(createImpersonationTrail({ audit: container.audit }));
  app.use(createRoutes(container));

  app.use(notFoundHandler);
  app.use(
    createErrorHandler({
      includeDebug: config.isDevelopment,
      logger,
      // `undefined` in a default clone (ADR-0066 §3): no DSN, no reporter, and
      // no adapter module ever evaluated.
      reporter: container.reporter,
    }),
  );

  return app;
};
