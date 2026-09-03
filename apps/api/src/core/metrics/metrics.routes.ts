import { timingSafeEqual } from "node:crypto";

import { Router, type Request, type RequestHandler } from "express";

import { unauthenticated } from "../errors/index.js";
import { sendText } from "../http/index.js";
import { noStore } from "../middleware/index.js";
import type { Metrics } from "./metrics.js";

/**
 * `GET /metrics` (ADR-0066 §2) — unversioned, beside `/health`, and mounted
 * **before** the `/api/v1` limiter for the reason ADR-0016 put health there:
 * an operational endpoint that can be rate-limited takes a working instance
 * out of rotation, and a scraper polling every fifteen seconds would spend a
 * limiter's budget by lunchtime.
 *
 * It is not `/health`'s sibling in every respect. A probe is cheap,
 * unauthenticated and says nothing; a scrape is an unbounded body of counters
 * that **names every route the API has**, which is a map of the attack surface
 * — so it is behind a bearer token whenever one is configured, and
 * `NODE_ENV=production` refuses an unset one at startup.
 */

/**
 * The bearer token, or `undefined`.
 *
 * Deliberately only the `Bearer` scheme, and the comparison below is
 * constant-time: a token compared with `===` leaks its prefix to anyone who can
 * time the endpoint, which is the same argument ADR-0018 makes about session
 * tokens.
 */
const bearerToken = (req: Request): string | undefined => {
  const header = req.get("authorization");

  if (header === undefined) return undefined;

  const [scheme, ...rest] = header.split(" ");

  return scheme?.toLowerCase() === "bearer" && rest.length > 0
    ? rest.join(" ")
    : undefined;
};

/** Constant-time equality over two UTF-8 strings of any length. */
const matches = (presented: string, expected: string): boolean => {
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");

  // `timingSafeEqual` throws on a length mismatch, which would itself be the
  // oracle: hash both sides to a fixed width first by comparing equal-length
  // buffers, and fold the length check into the result.
  return a.length === b.length && timingSafeEqual(a, b);
};

export interface MetricsRouterDeps {
  readonly metrics: Metrics;
  /**
   * `METRICS_TOKEN`, or `undefined` when the deployment set none — which the
   * config schema permits outside production only.
   */
  readonly token: string | undefined;
}

export const createMetricsRouter = ({
  metrics,
  token,
}: MetricsRouterDeps): Router => {
  const router = Router();

  const guard: RequestHandler = (req, _res, next) => {
    if (token === undefined) {
      next();

      return;
    }

    const presented = bearerToken(req);

    // `unauthenticated()`, so the refusal is the ADR-0013 envelope with a
    // request id like every other refusal — a scraper's misconfiguration shows
    // up in the same log line as everything else.
    next(
      presented !== undefined && matches(presented, token)
        ? undefined
        : unauthenticated("Metrics token required"),
    );
  };

  // A scrape must never be cached — by a proxy, by the scraper, or by anything
  // between them (ADR-0016 puts the same header on the probes).
  router.use(noStore);
  router.get("/", guard, (_req, res, next) => {
    // `.catch` **after** `.then`, not `then(onFulfilled, onRejected)`: the
    // two-argument form leaves a throw inside `sendText` — `res.end` on a
    // connection that was already answered or torn down — as an unhandled
    // rejection, which is a process exit under Node's default policy. On the
    // one route that sits outside every limiter.
    metrics
      .render()
      .then(({ contentType, body }) => {
        sendText(res, contentType, body);
      })
      .catch(next);
  });

  return router;
};
