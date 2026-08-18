import type { RequestHandler } from "express";

import { createRequestContext, runWithContext } from "../context/index.js";

/**
 * Builds `req.ctx` and enters the `AsyncLocalStorage` scope (ADR-0010).
 *
 * Second in the chain, directly after `pino-http`, so that everything below —
 * including `helmet`, `cors` and the body parser — runs with a context
 * available. `req.log` is the child logger `pino-http` already bound with the
 * request id, so the two never disagree.
 *
 * `next` is called *inside* `runWithContext`: the whole downstream chain, and
 * every promise it creates, inherits the store.
 */
export const createContextMiddleware = (): RequestHandler => {
  return (req, _res, next) => {
    req.ctx = createRequestContext({
      requestId: String(req.id),
      logger: req.log,
      ip: req.ip,
      userAgent: req.get("user-agent"),
    });

    runWithContext(req.ctx, next);
  };
};
