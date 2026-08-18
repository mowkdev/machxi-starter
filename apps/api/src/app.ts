import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import qs from "qs";

import type { Container } from "./core/container.js";
import {
  createContextMiddleware,
  createErrorHandler,
  createHttpLogger,
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

  app.use(helmet());
  app.use(
    cors({
      // An empty allow-list means no browser origin is permitted, which is
      // what `false` says to `cors`. Non-browser clients are unaffected —
      // CORS is enforced by the browser, not by this middleware.
      origin:
        config.http.corsOrigins.length === 0
          ? false
          : [...config.http.corsOrigins],
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      exposedHeaders: ["X-Request-Id"],
    }),
  );

  app.use(express.json({ limit: JSON_BODY_LIMIT, strict: true }));
  app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));

  app.use(createRoutes(container));

  app.use(notFoundHandler);
  app.use(createErrorHandler({ includeDebug: config.isDevelopment }));

  return app;
};
