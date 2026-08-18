import type { RequestHandler } from "express";
import { isIP } from "node:net";

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
/**
 * `req.ip`, but only when it is genuinely an address.
 *
 * Under any non-`false` `TRUST_PROXY`, Express derives `req.ip` from
 * `X-Forwarded-For` and `proxy-addr` does not check that the result is an IP —
 * so a misconfigured hop count makes it an arbitrary attacker-controlled
 * string. That string ends up in `sessions.ip`, which is an `inet` column
 * (Postgres raises `22P02`, and login answers 500 to an unauthenticated
 * caller), and in a rate-limit key, where it is unbounded. The user agent is
 * bounded for the same reason; this is the same rule applied to the other
 * value that comes from the environment rather than from a schema (ADR-0020).
 */
const clientIp = (raw: string | undefined): string | undefined =>
  raw !== undefined && isIP(raw) !== 0 ? raw : undefined;

export const createContextMiddleware = (): RequestHandler => {
  return (req, _res, next) => {
    req.ctx = createRequestContext({
      requestId: String(req.id),
      logger: req.log,
      ip: clientIp(req.ip),
      userAgent: req.get("user-agent"),
    });

    runWithContext(req.ctx, next);
  };
};
