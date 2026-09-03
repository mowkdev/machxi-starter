import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";

import type { AppConfig } from "../config/index.js";
import { rateLimited } from "../errors/index.js";
import type { RateLimitStore } from "../rate-limit/index.js";

/**
 * Rate limiting (ADR-0020 §Rate limiting).
 *
 * Four limiters, all sharing one window and one failure shape: the global one
 * on `/api`, a strict one on login and registration, one on *failed*
 * refreshes, and — since `D13.4` — one on the impersonation mint, the only one
 * in this file keyed on a principal rather than on an address (ADR-0057 §1).
 * `/health` is deliberately outside all of them — a probe that gets
 * rate-limited takes a healthy instance out of rotation (ADR-0016).
 *
 * The store is a **parameter** since `D14.6` (ADR-0066 §4, a delta on
 * ADR-0020): `undefined` selects `express-rate-limit`'s in-memory default,
 * which counts per process, and a `Store` — Redis, when `REDIS_URL` is set —
 * makes one budget out of N instances. The *choice* is made once in
 * `core/rate-limit` and applied to all four factories from the composition
 * root, because a per-limiter choice is a choice one limiter can be left out
 * of — but each limiter is handed its **own** store instance under its own key
 * prefix, because three of the four key on the address alone and would
 * otherwise share a counter.
 *
 * **None of the limits, windows or keys changed with it.** ADR-0020's
 * `300 / 15 min / IP`, `10 / 15 min / IP + email` and `5 / 15 min / IP` on
 * failed refreshes, and ADR-0057 §1's per-staff-principal mint budget, are
 * exactly as decided; only where the counter lives is configurable.
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

const baseOptions = (windowMs: number, store: RateLimitStore) =>
  ({
    windowMs,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: ipKey,
    // `undefined` is not the same as absent to a spread, so the key is only
    // written when there is a store: `{ store: undefined }` would override
    // `express-rate-limit`'s own default with nothing.
    ...(store === undefined ? {} : { store }),
    /**
     * **Fail closed** (ADR-0066 §4). The library's default, stated here
     * because it is a decision rather than an accident: a configured Redis
     * that cannot be reached must refuse requests, not admit every one of
     * them. The refusal goes through the error handler like any other, so the
     * store's error is logged with the request id that hit it.
     */
    passOnStoreError: false,
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
export const createGlobalRateLimiter = (
  config: AppConfig,
  store: RateLimitStore,
): RequestHandler =>
  rateLimit({
    ...baseOptions(RATE_LIMIT_WINDOW_MS, store),
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
export const createLoginRateLimiter = (
  config: AppConfig,
  store: RateLimitStore,
): RequestHandler =>
  rateLimit({
    ...baseOptions(RATE_LIMIT_WINDOW_MS, store),
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
export const createRefreshRateLimiter = (
  config: AppConfig,
  store: RateLimitStore,
): RequestHandler =>
  rateLimit({
    ...baseOptions(RATE_LIMIT_WINDOW_MS, store),
    limit: config.rateLimit.refreshMax,
    skipSuccessfulRequests: true,
    requestWasSuccessful: (_req, res) => res.statusCode !== 401,
  });

/**
 * `RATE_LIMIT_IMPERSONATION_MAX / 15 min / **staff principal**` on the mint
 * (ADR-0057 §1).
 *
 * The only limiter here that is not keyed on an address, because the request
 * it bounds has no address-shaped identity worth bounding: a mint is
 * authenticated, high-value, and performed from an office whose whole support
 * desk may share one egress IP. A per-IP budget there is either so loose that
 * it bounds nothing or so tight that one operator's afternoon locks out the
 * team. The actor is the thing to budget, and ten per window is a support
 * desk's day — an account spending it is worth a look.
 *
 * Keying on the principal is also what forces this limiter to mount **after**
 * `authenticate`: `ctx.principal` does not exist before it. ADR-0057 §1 states
 * that as a named refinement of ADR-0011's rate-limit-first order rather than
 * leaving it as an exception somebody invented at a route.
 *
 * The unauthenticated fallback is the address, and it is unreachable by
 * construction — the mint sits inside the admin segment, behind
 * `authenticate("staff")` and `authorize("admin")`. It is written anyway so
 * that a future mount which got the order wrong degrades to a per-IP limit
 * rather than to one shared bucket for every anonymous caller, which would be
 * a limiter that stops the whole world at ten.
 */
export const createImpersonationRateLimiter = (
  config: AppConfig,
  store: RateLimitStore,
): RequestHandler =>
  rateLimit({
    ...baseOptions(RATE_LIMIT_WINDOW_MS, store),
    limit: config.rateLimit.impersonationMax,
    keyGenerator: (req) => {
      const { principal } = req.ctx;

      return principal === null
        ? `anon:${ipKey(req)}`
        : `${principal.kind}:${principal.id}`;
    },
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
