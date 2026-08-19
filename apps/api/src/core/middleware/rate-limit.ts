import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";

import type { AppConfig } from "../config/index.js";
import { rateLimited } from "../errors/index.js";

/**
 * Rate limiting (ADR-0020 §Rate limiting).
 *
 * Three limiters, all sharing one window and one failure shape: the global one
 * on `/api`, a strict one on login and registration, and one on *failed*
 * refreshes. `/health` is deliberately outside all of them — a probe that gets
 * rate-limited takes a healthy instance out of rotation (ADR-0016).
 *
 * The store is `express-rate-limit`'s in-memory default, which is per process.
 * A multi-instance deployment therefore gets N times the configured limit
 * until the Redis store is wired in; that is recorded in ADR-0020
 * §Consequences and is a configuration change, not a code one.
 */

/** The window every limit in ADR-0020 is expressed over. */
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/** Longest email accepted into a rate-limit key (RFC 5321). */
const MAX_KEY_EMAIL_LENGTH = 254;

/**
 * Seconds until the client's counter resets.
 *
 * `resetTime` is what the store actually knows; the window is only a fallback
 * for a store that does not report one. Rounded up, so a client that obeys it
 * is never told to retry a moment too early.
 */
const retryAfterSeconds = (req: Request, windowMs: number): number => {
  // `express-rate-limit` attaches `rateLimit` to the request but ships no
  // Express augmentation for it, so the shape is stated here rather than
  // assumed. Optional throughout: a custom store need not report a reset time.
  const { rateLimit: info } = req as Request & {
    rateLimit?: { resetTime?: Date };
  };
  const resetTime = info?.resetTime;

  const ms =
    resetTime === undefined ? windowMs : resetTime.getTime() - Date.now();

  return Math.max(1, Math.ceil(ms / 1000));
};

/**
 * Shared options: the `RATE_LIMITED` envelope, `Retry-After`, and the
 * `RateLimit-*` headers in their standardised (draft-8) form.
 *
 * The failure goes through `next(...)` rather than a response written here —
 * the error middleware is the only writer of an error body (ADR-0013), so a
 * 429 has the same shape, the same `requestId` and the same log line as every
 * other failure.
 */
/**
 * The client address, as the context middleware validated it.
 *
 * Not `req.ip` directly: behind a proxy that value can be an arbitrary string
 * (see `context.ts`), and an unbounded attacker-chosen string is a poor key for
 * an in-memory store. `ipKeyGenerator` then groups IPv6 addresses by /64, so
 * one client cannot rotate through its own subnet for a fresh budget.
 */
const ipKey = (req: Request): string => ipKeyGenerator(req.ctx.ip ?? "");

const baseOptions = (windowMs: number) =>
  ({
    windowMs,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: ipKey,
    handler: (req: Request, res: Response, next: NextFunction) => {
      const seconds = retryAfterSeconds(req, windowMs);

      res.setHeader("Retry-After", String(seconds));
      next(rateLimited(seconds));
    },
  }) as const;

/**
 * `300 / 15 min / IP` across `/api` (ADR-0020).
 *
 * A backstop against a client hammering any endpoint, not a substitute for the
 * strict limits below: 300 requests of *login* would already be far too many.
 */
export const createGlobalRateLimiter = (config: AppConfig): RequestHandler =>
  rateLimit({
    ...baseOptions(RATE_LIMIT_WINDOW_MS),
    limit: config.rateLimit.globalMax,
  });

/**
 * `10 / 15 min / IP + email` on login and registration (ADR-0020).
 *
 * Keyed on both, so one address behind a shared NAT cannot lock out everyone
 * else there, and a single IP cannot walk a password list across many
 * addresses without also tripping the global limit.
 *
 * This is a **liveness** control as much as an anti-brute-force one: every
 * request it admits costs an argon2 hash, which holds a libuv thread and
 * 64 MiB for ~130 ms (ADR-0020 §Hashing cost vs. liveness).
 */
export const createLoginRateLimiter = (config: AppConfig): RequestHandler =>
  rateLimit({
    ...baseOptions(RATE_LIMIT_WINDOW_MS),
    limit: config.rateLimit.loginMax,
    keyGenerator: (req) => `${ipKey(req)}:${keyEmail(req)}`,
  });

/**
 * `5 / 15 min / IP` on **failed** refreshes (ADR-0020).
 *
 * `skipSuccessfulRequests` is the whole point: a client whose access token
 * expires every 15 minutes refreshes legitimately and must never spend its
 * budget doing so. What this bounds is guessing at opaque tokens.
 *
 * **Only a rejected token spends budget** — `401`, and nothing else. Charging
 * every non-2xx was defensible while the only way to reach this endpoint was
 * to present a token, and stopped being so with cookie transport (ADR-0029):
 * the limiter runs before `csrfGuard`, is keyed on IP alone, and a `403`
 * CSRF failure or a `400` empty body would have counted. Any web page can
 * `fetch` this endpoint five times with no cookie and no body, and on cookie
 * transport a locked-out browser has no token in JavaScript to retry with —
 * so a spent budget is not "retry later", it is the session ending at the next
 * access-token expiry.
 */
export const createRefreshRateLimiter = (config: AppConfig): RequestHandler =>
  rateLimit({
    ...baseOptions(RATE_LIMIT_WINDOW_MS),
    limit: config.rateLimit.refreshMax,
    skipSuccessfulRequests: true,
    requestWasSuccessful: (_req, res) => res.statusCode !== 401,
  });

/**
 * The email from a login body, normalised for use in a key.
 *
 * This reads `req.body` directly, which no controller may do (ADR-0011) — the
 * limiter runs *before* `validate`, by design: a request that is rejected by a
 * schema must still count against the limit, or an attacker gets unlimited
 * attempts by sending a body that fails validation. It is bounded and
 * lower-cased here because an unbounded value from an unvalidated body would
 * otherwise become a memory-store key.
 */
const keyEmail = (req: Request): string => {
  const body: unknown = req.body;
  const email =
    typeof body === "object" && body !== null && "email" in body
      ? (body as { email: unknown }).email
      : undefined;

  return typeof email === "string"
    ? email.trim().toLowerCase().slice(0, MAX_KEY_EMAIL_LENGTH)
    : "";
};
