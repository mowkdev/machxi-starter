import type { RequestHandler } from "express";

/**
 * `Cache-Control: no-store` (ADR-0020).
 *
 * Applied to health (ADR-0016) and, from the auth module on, to every endpoint
 * that issues or consumes credentials: a cached `/auth/me` or a cached token
 * response in a shared proxy is a session leak, and `no-store` is the only
 * directive that also forbids writing it to disk.
 */
export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
};
