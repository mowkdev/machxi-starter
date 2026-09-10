import { declaredErrorEnvelopeSchema } from "@repo/contracts";
import type { AppConfig } from "../src/core/config/index.js";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestApp, type TestApp } from "./support/app.js";
import { resetAndSeed, superAdmin } from "./support/seed.js";

/**
 * ADR-0020 §Rate limiting, end to end.
 *
 * `.env.test` sets the three limits effectively to infinity so the rest of the
 * suite is not throttled; these tests build their own apps with real limits
 * instead. That works because the memory store lives inside the limiter
 * instance, which lives inside one app — so a count here can never leak into
 * another file.
 *
 * What is asserted is not only "it stops at N" but the shape of the refusal:
 * the standard error envelope, the `RATE_LIMITED` code and a `Retry-After` a
 * client can obey.
 */

const withLimits = (limits: Partial<AppConfig["rateLimit"]>) => ({
  config: (config: AppConfig): AppConfig => ({
    ...config,
    rateLimit: { ...config.rateLimit, ...limits },
  }),
});

const LOGIN = "/api/v1/admin/auth/login";
const REFRESH = "/api/v1/admin/auth/refresh";

describe("login rate limit", () => {
  let harness: TestApp;

  beforeAll(async () => {
    harness = createTestApp(withLimits({ loginMax: 2 }));
    await resetAndSeed({ db: harness.db, hasher: harness.container.hasher });
  });

  afterAll(async () => {
    await harness.close();
  });

  const attempt = (email: string) =>
    supertest(harness.app).post(LOGIN).send({ email, password: "wrong-guess" });

  it("refuses further attempts with the RATE_LIMITED envelope", async () => {
    await attempt("target@machxi.local").expect(401);
    await attempt("target@machxi.local").expect(401);

    const response = await attempt("target@machxi.local").expect(429);

    expect(declaredErrorEnvelopeSchema.safeParse(response.body).success).toBe(
      true,
    );
    expect(response.body.error.code).toBe("RATE_LIMITED");
    // The envelope carries the wait as well as the header, so a client that
    // only parses the body can still back off (ADR-0013).
    expect(response.body.error.details[0]).toMatchObject({
      code: "retryAfter",
    });
    expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("keys on the address as well as the IP", async () => {
    // Otherwise one address behind a shared NAT locks out everyone there.
    await attempt("first@machxi.local").expect(401);
    await attempt("first@machxi.local").expect(401);
    await attempt("first@machxi.local").expect(429);

    await attempt("second@machxi.local").expect(401);
  });

  it("counts an attempt that never reached a schema", async () => {
    // The limiter runs before `validate` on purpose: otherwise an attacker
    // gets unlimited attempts by sending a body that fails validation.
    const email = "malformed@machxi.local";

    await supertest(harness.app).post(LOGIN).send({ email }).expect(400);
    await supertest(harness.app).post(LOGIN).send({ email }).expect(400);
    await supertest(harness.app)
      .post(LOGIN)
      .send({ email, password: "wrong-guess" })
      .expect(429);
  });

  it("does not throttle a successful login of a different account", async () => {
    await supertest(harness.app).post(LOGIN).send(superAdmin()).expect(200);
  });

  it("shares one budget across both segments and registration", async () => {
    // The limiter is built once in the container, not per route factory: a
    // limiter *holds* the counter, so one instance per mount would silently
    // turn ADR-0020's "10 per 15 minutes" into ten per login endpoint.
    const email = "shared-budget@machxi.local";
    const body = { email, password: "wrong-guess" };

    await supertest(harness.app).post(LOGIN).send(body).expect(401);
    await supertest(harness.app)
      .post("/api/v1/user/auth/login")
      .send(body)
      .expect(401);

    await supertest(harness.app)
      .post("/api/v1/public/auth/register")
      .send({ email, password: "a-perfectly-fine-password" })
      .expect(429);
  });
});

describe("refresh rate limit", () => {
  let harness: TestApp;

  beforeAll(async () => {
    harness = createTestApp(withLimits({ refreshMax: 2 }));
    await resetAndSeed({ db: harness.db, hasher: harness.container.hasher });
  });

  afterAll(async () => {
    await harness.close();
  });

  it("counts failures only, so legitimate refreshing is never throttled", async () => {
    // An access token expires every 15 minutes; a client that refreshes on
    // schedule must not spend a budget meant for token guessing.
    const login = await supertest(harness.app)
      .post(LOGIN)
      .send(superAdmin())
      .expect(200);

    let refreshToken: string = login.body.data.refreshToken;

    for (let round = 0; round < 4; round += 1) {
      const rotated = await supertest(harness.app)
        .post(REFRESH)
        .send({ refreshToken })
        .expect(200);

      refreshToken = rotated.body.data.refreshToken;
    }
  });

  it("stops guessing at opaque tokens", async () => {
    const guess = () =>
      supertest(harness.app)
        .post(REFRESH)
        .send({ refreshToken: "A".repeat(43) });

    await guess().expect(401);
    await guess().expect(401);

    const response = await guess().expect(429);

    expect(response.body.error.code).toBe("RATE_LIMITED");
  });
});

describe("global rate limit", () => {
  let harness: TestApp;

  beforeAll(() => {
    harness = createTestApp(withLimits({ globalMax: 2 }));
  });

  afterAll(async () => {
    await harness.close();
  });

  it("applies across /api regardless of the endpoint", async () => {
    await supertest(harness.app).get("/api/v1/admin/auth/me").expect(401);
    await supertest(harness.app).get("/api/v1/user/auth/me").expect(401);

    const response = await supertest(harness.app)
      .get("/api/v1/admin/auth/me")
      .expect(429);

    expect(response.body.error.code).toBe("RATE_LIMITED");
  });

  it("leaves health outside every limiter", async () => {
    // A throttled probe takes a working instance out of rotation, which is a
    // self-inflicted outage (ADR-0016, ADR-0020 §Residual risks).
    for (let poll = 0; poll < 5; poll += 1) {
      await supertest(harness.app).get("/health/live").expect(200);
    }
  });
});

/**
 * The two budgets on `password/forgot` (ADR-0071 §4, the second amended in at
 * `D18.5`).
 *
 * They are the only limiters in this repository that ration a **third party's**
 * inbox rather than the caller's own attempts, which is why they have a window
 * of their own and why there are two of them: one bounds what a single sender
 * may mail one mailbox, the other bounds what that mailbox receives from
 * everybody. Mounted together on one route, so each is proved by turning the
 * other off — otherwise the smaller number is the only one that ever fires and
 * the second limiter could be missing entirely without a test noticing.
 *
 * The addresses below belong to nobody. `forgot` answers `202` either way and
 * mails nothing, so what is exercised is the limiter and not the flow.
 */
const FORGOT = "/api/v1/user/auth/password/forgot";
const AN_HOUR = 3600;

describe("the per-sender forgot limit", () => {
  let harness: TestApp;

  beforeAll(() => {
    harness = createTestApp(
      withLimits({ passwordResetMax: 3, mailboxMax: 100_000 }),
    );
  });

  afterAll(async () => {
    await harness.close();
  });

  it("refuses the fourth request for one address, an hour out", async () => {
    const forgot = () =>
      supertest(harness.app)
        .post(FORGOT)
        .send({ email: "rationed@machxi.local" });

    await forgot().expect(202);
    await forgot().expect(202);
    await forgot().expect(202);

    const response = await forgot().expect(429);

    expect(response.body.error.code).toBe("RATE_LIMITED");
    // The window is the limiter's own: fifteen minutes here would be four
    // times the budget ADR-0071 §4 decided, with nothing failing to say so.
    const retryAfter = Number(response.headers["retry-after"]);

    expect(retryAfter).toBeGreaterThan(AN_HOUR - 120);
    expect(retryAfter).toBeLessThanOrEqual(AN_HOUR);
  });

  it("does not spend one mailbox's budget on another's", async () => {
    // Keyed on the address **and** the email, so one mailbox behind a shared
    // NAT cannot lock out everybody else there (ADR-0020's login key, reused).
    const forgot = (email: string) =>
      supertest(harness.app).post(FORGOT).send({ email });

    await forgot("first.tenant@machxi.local").expect(202);
    await forgot("first.tenant@machxi.local").expect(202);
    await forgot("first.tenant@machxi.local").expect(202);
    await forgot("first.tenant@machxi.local").expect(429);

    await forgot("second.tenant@machxi.local").expect(202);
  });
});

describe("the mailbox forgot limit", () => {
  let harness: TestApp;

  beforeAll(() => {
    harness = createTestApp(
      withLimits({ passwordResetMax: 100_000, mailboxMax: 5 }),
    );
  });

  afterAll(async () => {
    await harness.close();
  });

  it("refuses the sixth message to one mailbox even where the sender's budget is untouched", async () => {
    // The per-sender limiter is effectively off here, so the refusal can only
    // come from the counter keyed on the mailbox alone (ADR-0071 §4, amended
    // at `D18.5`). Without it, a caller who can vary its source address
    // delivers `3 × N` messages into a stranger's inbox with no ceiling: every
    // other limiter in this repository, the global one included, keys on that
    // same source.
    const forgot = () =>
      supertest(harness.app)
        .post(FORGOT)
        .send({ email: "flooded@machxi.local" });

    for (let sent = 0; sent < 5; sent += 1) {
      await forgot().expect(202);
    }

    const response = await forgot().expect(429);

    expect(response.body.error.code).toBe("RATE_LIMITED");
  });

  it("counts each mailbox separately", async () => {
    const forgot = (email: string) =>
      supertest(harness.app).post(FORGOT).send({ email });

    for (let sent = 0; sent < 5; sent += 1) {
      await forgot("busy@machxi.local").expect(202);
    }

    await forgot("busy@machxi.local").expect(429);
    await forgot("quiet@machxi.local").expect(202);
  });
});
