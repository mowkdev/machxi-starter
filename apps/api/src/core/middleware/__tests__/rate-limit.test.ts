import { createLogger } from "@repo/logger";
import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from "express";
import supertest from "supertest";
import { describe, expect, it } from "vitest";

import { loadConfig, type AppConfig } from "../../config/index.js";
import { createRequestContext } from "../../context/index.js";
import { isAppError } from "../../errors/index.js";
import {
  createLoginRateLimiter,
  createPasswordResetRateLimiter,
  createVerificationRateLimiter,
} from "../rate-limit.js";

/**
 * The two limiters that ration messages rather than attempts (ADR-0071 §3, §4).
 *
 * They are tested here rather than in `test/rate-limit.int.test.ts` because
 * neither is mounted yet — `forgot` lands at `D18.5` and `resend-verification`
 * at `D18.3` — and because what is worth proving needs no database: the budget
 * is `3` and **the window it is per is an hour**, not the fifteen minutes every
 * other limiter in the file shares. That distinction is worth a test of its own
 * for the reason `D18.1`'s review found it: a `3` reached for the only window
 * in `config.rateLimit` would deploy twelve messages an hour into a stranger's
 * inbox, four times the decided number, with nothing failing.
 *
 * The window is asserted through `Retry-After`, which is what a client
 * actually observes, rather than through a header spelling that belongs to
 * `express-rate-limit`'s draft.
 */

const config: AppConfig = loadConfig({
  NODE_ENV: "development",
  DATABASE_URL: "postgres://machxi:machxi@localhost:5432/machxi",
  JWT_ACCESS_SECRET: "a".repeat(32),
});

const AN_HOUR = 3600;
const FIFTEEN_MINUTES = 900;

/** `req.ctx` as the context middleware would have left it; `ipKey` reads it. */
const context: RequestHandler = (req, _res, next) => {
  req.ctx = createRequestContext({
    requestId: "01J0000000000000000000000A",
    logger: createLogger({ level: "silent", name: "rate-limit-test" }),
    ip: "203.0.113.7",
  });

  next();
};

/**
 * The refusal as the real pipeline shapes it: the limiter calls
 * `next(rateLimited(...))` and the error middleware is the only writer of a
 * body (ADR-0013). This stands in for it with the status alone — the envelope
 * is `envelope.int.test.ts`'s subject, not this file's.
 */
const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  res.status(isAppError(error) ? error.status : 500).end();
};

const appWith = (...limiters: RequestHandler[]) => {
  const app = express();

  app.use(express.json());
  app.use(context);

  for (const [index, limiter] of limiters.entries()) {
    app.post(`/${String(index)}`, limiter, (_req, res) => {
      res.status(202).end();
    });
  }

  app.use(errorHandler);

  return app;
};

const post = (app: express.Express, path: string, email: string) =>
  supertest(app).post(path).send({ email });

describe("the password reset limiter", () => {
  it("spends its budget over an hour, not over the shared window", async () => {
    const app = appWith(createPasswordResetRateLimiter(config, undefined));
    const email = "person@machxi.local";

    expect(config.rateLimit.passwordResetMax).toBe(3);

    await post(app, "/0", email).expect(202);
    await post(app, "/0", email).expect(202);
    await post(app, "/0", email).expect(202);

    const refused = await post(app, "/0", email).expect(429);
    const retryAfter = Number(refused.headers["retry-after"]);

    // An hour, give or take the milliseconds this test took: the whole point
    // of `RATE_LIMIT_PASSWORD_RESET_WINDOW` existing.
    expect(retryAfter).toBeGreaterThan(AN_HOUR - 60);
    expect(retryAfter).toBeLessThanOrEqual(AN_HOUR);
  });

  it("keys on the address as well as the IP", async () => {
    const app = appWith(createPasswordResetRateLimiter(config, undefined));

    await post(app, "/0", "first@machxi.local").expect(202);
    await post(app, "/0", "first@machxi.local").expect(202);
    await post(app, "/0", "first@machxi.local").expect(202);
    await post(app, "/0", "first@machxi.local").expect(429);

    // Otherwise one mailbox behind a shared NAT locks out everyone there.
    await post(app, "/0", "second@machxi.local").expect(202);
  });
});

describe("the verification limiter", () => {
  it("is a counter of its own, not a second mount of the reset limiter", async () => {
    const app = appWith(
      createPasswordResetRateLimiter(config, undefined),
      createVerificationRateLimiter(config, undefined),
    );
    const email = "person@machxi.local";

    await post(app, "/0", email).expect(202);
    await post(app, "/0", email).expect(202);
    await post(app, "/0", email).expect(202);
    await post(app, "/0", email).expect(429);

    // A person stuck on verification must not spend the recovery budget for
    // the same mailbox and find themselves unable to reset a password
    // (ADR-0071 §3, §4 — one number, two counters).
    //
    // On the memory store the separation is structural: `express-rate-limit`
    // gives every limiter its own store, so what this proves is that the
    // factories really are two limiters and not one reused. Where separation
    // is *earned* is Redis, whose key space is the prefix the composition root
    // passes — `core/rate-limit/__tests__/store.test.ts` enumerates those, and
    // it is the test that fails if the two names ever collide (`D18.2`'s
    // `code-reviewer`).
    await post(app, "/1", email).expect(202);
  });

  it("is per hour as well", async () => {
    const app = appWith(createVerificationRateLimiter(config, undefined));
    const email = "person@machxi.local";

    await post(app, "/0", email).expect(202);
    await post(app, "/0", email).expect(202);
    await post(app, "/0", email).expect(202);

    const refused = await post(app, "/0", email).expect(429);

    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(
      FIFTEEN_MINUTES,
    );
  });
});

describe("the limiters that were here first", () => {
  it("leaves login on the fifteen-minute window", async () => {
    // The regression this file exists to catch runs in both directions: the
    // new window must not become the shared one either (ADR-0020).
    const app = appWith(
      createLoginRateLimiter(
        { ...config, rateLimit: { ...config.rateLimit, loginMax: 1 } },
        undefined,
      ),
    );
    const email = "person@machxi.local";

    await post(app, "/0", email).expect(202);

    const refused = await post(app, "/0", email).expect(429);
    const retryAfter = Number(refused.headers["retry-after"]);

    expect(retryAfter).toBeGreaterThan(FIFTEEN_MINUTES - 60);
    expect(retryAfter).toBeLessThanOrEqual(FIFTEEN_MINUTES);
  });
});
