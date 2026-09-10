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
  createMailboxRateLimiter,
  createMailSourceRateLimiter,
  createPasswordResetRateLimiter,
  createTokenRouteRateLimiter,
  createVerificationRateLimiter,
} from "../rate-limit.js";

/**
 * The limiters that ration messages rather than attempts (ADR-0071 §3, §4).
 *
 * They are tested here rather than in `test/rate-limit.int.test.ts` because
 * what is worth proving about them needs no database and, above all, needs an
 * **address that can be varied**: three of the four differ from each other in
 * nothing but their key, and a mounted route behind a proxy this suite would
 * have to trust is the wrong place to vary one. The window is the other claim
 * — the budget is `3` and **the window it is per is an hour**, not the fifteen
 * minutes every other limiter in the file shares, a distinction worth a test
 * of its own for the reason `D18.1`'s review found it: a `3` reached for the
 * only window in `config.rateLimit` would deploy twelve messages an hour into
 * a stranger's inbox, four times the decided number, with nothing failing.
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

/**
 * `req.ctx` as the context middleware would have left it; `ipKey` reads it.
 *
 * The address is read from a header the test sets rather than fixed, because
 * one of the claims below is that a limiter's key does **not** contain it —
 * and an assertion about a value that never varies proves nothing. The real
 * middleware has already refused to set `ip` unless `node:net` agreed it was
 * one, which is what makes reading a header here faithful rather than lax.
 */
const context: RequestHandler = (req, _res, next) => {
  req.ctx = createRequestContext({
    requestId: "01J0000000000000000000000A",
    logger: createLogger({ level: "silent", name: "rate-limit-test" }),
    ip: req.get("X-Test-Client") ?? "203.0.113.7",
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

describe("the mailbox limiter", () => {
  const mailbox = () => appWith(createMailboxRateLimiter(config, undefined));
  const from = (app: express.Express, client: string, email: string) =>
    supertest(app).post("/0").set("X-Test-Client", client).send({ email });

  it("counts one mailbox however many callers ask about it", async () => {
    // The whole reason this limiter exists (ADR-0071 §4, amended at `D18.5`).
    // Every other limiter in the file keys on the caller's address, so all of
    // them vary together with the cheapest thing an attacker can change; five
    // different sources here spend one budget, and the sixth is refused.
    const app = mailbox();
    const email = "victim@machxi.local";

    expect(config.rateLimit.mailboxMax).toBe(5);

    for (let sender = 0; sender < 5; sender += 1) {
      await from(app, `203.0.113.${String(20 + sender)}`, email).expect(202);
    }

    const refused = await from(app, "198.51.100.4", email).expect(429);

    // Still the hour, not the shared fifteen minutes: it rations the same
    // thing the limiter beside it does.
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(
      FIFTEEN_MINUTES,
    );
  });

  it("keeps a budget per mailbox rather than one for everybody", async () => {
    const app = mailbox();

    for (let sent = 0; sent < 5; sent += 1) {
      await from(app, "203.0.113.7", "busy@machxi.local").expect(202);
    }

    await from(app, "203.0.113.7", "busy@machxi.local").expect(429);
    await from(app, "203.0.113.7", "quiet@machxi.local").expect(202);
  });

  it("falls back to the caller's own address when the body names none", async () => {
    // A body with no readable address is on its way to a `400` from
    // `validate`, but the limiter runs first and has to key it somehow.
    // Keying every such request on the empty string would put them all in one
    // bucket, and five malformed bodies an hour from anybody would then refuse
    // `forgot` to the whole world.
    const app = mailbox();
    const nameless = (client: string) =>
      supertest(app).post("/0").set("X-Test-Client", client).send({});

    for (let sent = 0; sent < 5; sent += 1) {
      await nameless("203.0.113.30").expect(202);
    }

    await nameless("203.0.113.30").expect(429);
    await nameless("203.0.113.31").expect(202);
  });
});

describe("the source limiter", () => {
  const source = () =>
    appWith(
      createMailSourceRateLimiter(
        { ...config, rateLimit: { ...config.rateLimit, mailSourceMax: 4 } },
        undefined,
      ),
    );
  const from = (app: express.Express, client: string, email: string) =>
    supertest(app).post("/0").set("X-Test-Client", client).send({ email });

  it("counts one source however many addresses it names", async () => {
    // The whole reason this limiter exists (ADR-0071 §4, amended at `D18.7`).
    // Both keys beside it carry the address the request names, so both hand a
    // fresh bucket to every new address — and a walk across strangers'
    // mailboxes is the one shape neither can refuse.
    const app = source();

    await from(app, "203.0.113.7", "first@machxi.local").expect(202);
    await from(app, "203.0.113.7", "second@machxi.local").expect(202);
    await from(app, "203.0.113.7", "third@machxi.local").expect(202);
    await from(app, "203.0.113.7", "fourth@machxi.local").expect(202);

    const refused = await from(app, "203.0.113.7", "fifth@machxi.local").expect(
      429,
    );

    // The same hour the other two mail budgets are per: what it rations is a
    // stranger's inbox, not an attacker's patience.
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(
      FIFTEEN_MINUTES,
    );
  });

  it("keeps a budget per source rather than one for everybody", async () => {
    const app = source();

    for (let sent = 0; sent < 4; sent += 1) {
      await from(
        app,
        "203.0.113.7",
        `walk-${String(sent)}@machxi.local`,
      ).expect(202);
    }

    await from(app, "203.0.113.7", "walk-4@machxi.local").expect(429);
    // A limiter that stopped the whole world at four would be worse than none.
    await from(app, "198.51.100.4", "walk-4@machxi.local").expect(202);
  });

  it("counts a body that names no address at all", async () => {
    // It has no fallback key to choose, unlike the mailbox limiter: the source
    // is on every request whatever the body says, so a request on its way to a
    // `400` from `validate` is counted like any other.
    const app = source();
    const nameless = () =>
      supertest(app).post("/0").set("X-Test-Client", "203.0.113.40").send({});

    for (let sent = 0; sent < 4; sent += 1) {
      await nameless().expect(202);
    }

    await nameless().expect(429);
  });

  it("defaults to a budget above the mailbox's own", async () => {
    // Not a free-floating number: at or below `mailboxMax` this limiter would
    // be the only one that ever fires and the pair beside it would be policy
    // written twice (ADR-0071 §4 — three keys, three questions).
    expect(config.rateLimit.mailSourceMax).toBe(20);
    expect(config.rateLimit.mailSourceMax).toBeGreaterThan(
      config.rateLimit.mailboxMax,
    );
  });
});

describe("the token-route limiter", () => {
  const tokenRoute = () =>
    appWith(
      createTokenRouteRateLimiter(
        { ...config, rateLimit: { ...config.rateLimit, loginMax: 2 } },
        undefined,
      ),
    );

  it("cannot be reset by a field the endpoint's schema does not have", async () => {
    // The whole reason this factory exists (`D18.7`'s `security-reviewer`).
    // `createLoginRateLimiter` keys on `IP + keyEmail(req)` read from the
    // *unvalidated* body, which is right on `login`, where `email` is a field
    // of the schema. On `password/reset` and `invitations/lookup` it is not —
    // so a caller could invent one and open a fresh bucket per request, and
    // the budget would exist in the docblock only.
    const app = tokenRoute();
    const attempt = (email: string) =>
      supertest(app).post("/0").send({ token: "x", email });

    await attempt("bucket-1@machxi.local").expect(202);
    await attempt("bucket-2@machxi.local").expect(202);
    await attempt("bucket-3@machxi.local").expect(429);
  });

  it("still counts per source, on the shared fifteen minutes", async () => {
    const app = tokenRoute();
    const from = (client: string) =>
      supertest(app).post("/0").set("X-Test-Client", client).send({});

    await from("203.0.113.50").expect(202);
    await from("203.0.113.50").expect(202);

    const refused = await from("203.0.113.50").expect(429);

    // ADR-0020's window, not ADR-0071 §4's hour: what it rations is attempts,
    // not somebody else's inbox.
    const retryAfter = Number(refused.headers["retry-after"]);

    expect(retryAfter).toBeGreaterThan(FIFTEEN_MINUTES - 60);
    expect(retryAfter).toBeLessThanOrEqual(FIFTEEN_MINUTES);

    // And one source's spent budget is not everybody's.
    await from("198.51.100.9").expect(202);
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
