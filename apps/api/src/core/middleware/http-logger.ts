import type { Logger } from "@repo/logger";
import type { RequestHandler } from "express";
import type { IncomingMessage, ServerResponse } from "node:http";
import { pinoHttp } from "pino-http";
import { uuidv7 } from "uuidv7";

import type { RequestContext } from "../context/index.js";

/**
 * Access logging and request-id generation (ADR-0005), first in the chain.
 *
 * It owns the request id because every later line — including the context
 * middleware's own child logger — has to carry the same one, and it is the
 * only middleware guaranteed to run before anything can fail.
 */

/** Header the id is read from and echoed on. */
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * An inbound id is honoured only in this shape (ADR-0005).
 *
 * The id is echoed in a response header and written into every log line, so an
 * unbounded client-supplied string is both a log-injection vector and a way to
 * bloat every line of a trace. Anything else is silently replaced rather than
 * rejected: a bad correlation id is not worth failing a request over.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

const HEALTH_PATH = "/health";

/**
 * `/health` and everything under it — not every path that merely starts with
 * the string, which would quietly demote a future `/health-report` endpoint to
 * `debug` and hide it from the access log.
 */
const isHealthPath = (url: string | undefined): boolean =>
  url === HEALTH_PATH || url?.startsWith(`${HEALTH_PATH}/`) === true;

/** Reuses a valid inbound id, otherwise mints a UUIDv7 (time-ordered, ADR-0006). */
export const resolveRequestId = (inbound: unknown): string => {
  const candidate = Array.isArray(inbound) ? inbound[0] : inbound;

  return typeof candidate === "string" && REQUEST_ID_PATTERN.test(candidate)
    ? candidate
    : uuidv7();
};

/**
 * Level by outcome (ADR-0005): client failures are `warn`, server failures
 * `error`, everything else `info`.
 *
 * A successful health check is `debug`, because an orchestrator polls it every
 * few seconds and the line says nothing — a *failing* one keeps its real level,
 * which is the only time anyone wants to read it.
 *
 * Exported as a pure function so the mapping is unit-tested rather than
 * inferred from what a running server happened to print.
 */
export const accessLogLevel = ({
  url,
  statusCode,
  failed,
}: {
  url: string | undefined;
  statusCode: number;
  failed: boolean;
}): "debug" | "info" | "warn" | "error" => {
  if (failed || statusCode >= 500) return "error";
  if (statusCode >= 400) return "warn";

  return isHealthPath(url) ? "debug" : "info";
};

/**
 * The completion line carries what ADR-0005 lists and nothing else.
 *
 * pino's default serialisers dump every request and response header, which is
 * both noise and a standing risk: the redaction list has to keep pace with
 * every header that might one day carry a credential. Naming the four fields
 * that are actually wanted inverts that — a new header is not logged unless
 * someone adds it here.
 */
const serializers = {
  req: (req: LoggedRequest) => ({
    id: req.id,
    method: req.method,
    url: requestPath(req),
  }),
  res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
};

/**
 * What the access log reads off a request. `originalUrl` is Express's; the base
 * `IncomingMessage` has only `url`.
 */
type LoggedRequest = IncomingMessage & {
  id?: unknown;
  originalUrl?: string;
  ctx?: RequestContext;
};

/**
 * The path as the client sent it.
 *
 * **Not `req.url`.** Express rewrites that to the mount-relative path while a
 * sub-router dispatches — `/health/ready` becomes `/ready` — and restores it
 * when the stack unwinds. A handler that responds asynchronously therefore
 * completes at a moment when `req.url` may still be the stripped form, so a
 * level rule or a log field keyed on it is right or wrong depending on whether
 * the route happened to await something. `originalUrl` is set once and never
 * rewritten.
 */
const requestUrl = (req: LoggedRequest): string | undefined =>
  req.originalUrl ?? req.url;

/**
 * The path, with the query string removed.
 *
 * Redaction (ADR-0005) matches object *keys*; a credential inside a URL string
 * is invisible to it, so a future `?token=`, `?code=` or `?email=` would be
 * written verbatim into every access line and kept for the whole log retention
 * period. Dropping the query at the source is the only place that is certain,
 * and the parameters an endpoint actually accepts are already described by its
 * schema (ADR-0011).
 */
const requestPath = (req: LoggedRequest): string | undefined =>
  requestUrl(req)?.split("?")[0];

/**
 * `principal` on the access line once the request is authenticated (ADR-0005).
 * At completion time `ctx` is there unless the request failed before the
 * context middleware ran.
 */
const principalProps = (
  req: LoggedRequest,
): { principalId: string; population: string } | Record<string, never> => {
  const principal = req.ctx?.principal;

  return principal == null
    ? {}
    : { principalId: principal.id, population: principal.kind };
};

export const createHttpLogger = (logger: Logger): RequestHandler =>
  pinoHttp({
    logger,
    serializers,

    genReqId: (req: IncomingMessage, res: ServerResponse): string => {
      const id = resolveRequestId(req.headers[REQUEST_ID_HEADER]);

      // Echoed so a user or a Postman run can quote the id from a failing
      // response and an operator can find the line (ADR-0010).
      res.setHeader("X-Request-Id", id);

      return id;
    },

    customLogLevel: (req, res, err) =>
      accessLogLevel({
        url: requestPath(req),
        statusCode: res.statusCode,
        failed: err != null,
      }),

    customProps: (req) => principalProps(req),
  });
