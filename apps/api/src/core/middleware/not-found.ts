import type { RequestHandler } from "express";

import { notFound } from "../errors/index.js";

/**
 * Turns "no route matched" into the standard error envelope (ADR-0013).
 *
 * Mounted after every router and before the error handler, so an unknown path —
 * including one under `/api/v1` — answers with the same shape as any other
 * failure instead of Express's HTML default page.
 *
 * `ROUTE_NOT_FOUND` rather than plain `NOT_FOUND`: a client can tell "you
 * called a URL that does not exist" (fix the client) from "the resource you
 * addressed is gone" (fix the data).
 */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(notFound("Route not found", "ROUTE_NOT_FOUND"));
};
