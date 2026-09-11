import { declaredErrorEnvelopeSchema } from "@repo/contracts";
import type { AppConfig } from "../src/core/config/index.js";
import supertest from "supertest";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { login } from "./support/actors.js";
import { createTestApp, type TestApp } from "./support/app.js";
import {
  FIXTURE_PASSWORD,
  FIXTURE_USERS,
  resetAndSeed,
  superAdmin,
} from "./support/seed.js";

/**
 * ADR-0020 §Rate limiting, end to end.
 *
 * `.env.test` sets those limits effectively to infinity so the rest of the
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
 * The budgets on `password/forgot` (ADR-0071 §4, the second amended in at
 * `D18.5` and the third at `D18.7`).
 *
 * They are the only limiters in this repository that ration a **third party's**
 * inbox rather than the caller's own attempts, which is why they share a window
 * of their own and why there are three of them: what one sender may mail one
 * mailbox, what that mailbox receives from everybody, and what one sender may
 * mail in total. Mounted together on one route, so each is proved by turning
 * the others off — otherwise the smallest number is the only one that ever
 * fires and a limiter could be missing entirely without a test noticing.
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

/**
 * The invited mailbox's budget on the one sender an *authenticated* caller
 * drives (ADR-0071 §5, amended at `D18.7` on that step's `security-reviewer`).
 *
 * §5 first said this send needed no budget, because ADR-0067 §2 refuses a
 * second outstanding offer to one address in one organization. The case below
 * is the reason that argument does not hold: revoking an offer and making it
 * again is two requests, and nothing caps how many organizations one account
 * may create — so without a limiter the ceiling on messages into a stranger's
 * inbox was the global one.
 */
describe("the invitation mailbox limit", () => {
  let harness: TestApp;
  let ownerToken: string;
  let orgId: string;

  beforeAll(async () => {
    harness = createTestApp(withLimits({ mailboxMax: 2 }));
    await resetAndSeed({ db: harness.db, hasher: harness.container.hasher });

    const owner = await login(harness.app, "user", {
      email: FIXTURE_USERS.active,
      password: FIXTURE_PASSWORD,
    });

    ownerToken = owner.accessToken;

    const mine = await supertest(harness.app)
      .get("/api/v1/user/orgs")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);

    orgId = (mine.body.data as { id: string; slug: string }[]).find(
      (row) => row.slug === "acme",
    )!.id;
  });

  afterAll(async () => {
    await harness.close();
  });

  const invite = (email: string) =>
    supertest(harness.app)
      .post(`/api/v1/user/orgs/${orgId}/invitations`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email, role: "member" });

  const revoke = (id: string) =>
    supertest(harness.app)
      .delete(`/api/v1/user/orgs/${orgId}/invitations/${id}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(204);

  it("counts revoke-and-invite-again against the invited address", async () => {
    const email = "flooded.invitee@machxi.local";

    const first = await invite(email).expect(201);

    await revoke(first.body.data.id);

    const second = await invite(email).expect(201);

    await revoke(second.body.data.id);

    // The pending check would have allowed a third, and a fourth, and so on:
    // it is the *limiter* refusing here, and its key is the mailbox.
    const response = await invite(email).expect(429);

    expect(response.body.error.code).toBe("RATE_LIMITED");
  });

  it("leaves onboarding a team alone, the key being the recipient", async () => {
    // Thirty invitations to thirty people are thirty budgets. A limiter keyed
    // on the caller would have refused the honest case this endpoint exists
    // for, which is why this one is not.
    await invite("first.colleague@machxi.local").expect(201);
    await invite("second.colleague@machxi.local").expect(201);
    await invite("third.colleague@machxi.local").expect(201);
  });
});

/**
 * The third of §4's keys, mounted (ADR-0071 §4, amended at `D18.7` on the
 * operator's decision).
 *
 * Proved with the other two effectively off, for the reason they are proved
 * with each other off: mounted together only the smallest number ever fires,
 * and this limiter could be missing entirely without a test noticing. What is
 * asserted here and nowhere else is the thing that makes it worth mounting —
 * **one counter across four routes**, so a source that has spent its budget on
 * `forgot` cannot start again on `register` or `resend-verification`. The key
 * itself is the unit file's, where a source address can be varied without a
 * proxy to trust.
 */
const RESEND = "/api/v1/public/auth/resend-verification";
const REGISTER = "/api/v1/public/auth/register";

describe("the per-source mail limit", () => {
  let harness: TestApp;

  /*
   * A fresh app per test, where every other block here shares one.
   *
   * This is the only limiter in the file whose key is identical for every
   * request the suite can make — supertest drives one loopback address — so
   * two tests in one app would be one continuing budget, and the second would
   * start already refused. The counter lives in the limiter instance, which
   * lives in the app (ADR-0066 §4), so a new app is a new budget.
   */
  beforeEach(() => {
    harness = createTestApp(
      withLimits({
        passwordResetMax: 100_000,
        mailboxMax: 100_000,
        mailSourceMax: 4,
      }),
    );
  });

  afterEach(async () => {
    await harness.close();
  });

  it("refuses a walk across distinct addresses that neither other budget sees", async () => {
    // Four different mailboxes, so the mailbox counter holds one apiece and
    // the per-sender counter holds one apiece: both would admit the fifth.
    const forgot = (email: string) =>
      supertest(harness.app).post(FORGOT).send({ email });

    for (let sent = 0; sent < 4; sent += 1) {
      await forgot(`stranger-${String(sent)}@machxi.local`).expect(202);
    }

    const response = await forgot("stranger-4@machxi.local").expect(429);

    expect(response.body.error.code).toBe("RATE_LIMITED");
    expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("is one counter across every endpoint that mails a stranger", async () => {
    // The sharing is the decision (ADR-0071 §4): a budget per endpoint would
    // be three budgets for one source to walk in turn. Two on `forgot` and
    // two on `resend-verification` spend it, and `register` — which mails a
    // link to an address the caller typed, the same walk under a different
    // verb — is refused on the strength of requests it never saw.
    //
    // Nothing is created by this test, deliberately: the refusal happens
    // above the controller, so the account `register` names is never written
    // and the file stays independent of the seeds.
    const spend = (path: string, email: string) =>
      supertest(harness.app).post(path).send({ email }).expect(202);

    await spend(FORGOT, "shared-0@machxi.local");
    await spend(FORGOT, "shared-1@machxi.local");
    await spend(RESEND, "shared-2@machxi.local");
    await spend(RESEND, "shared-3@machxi.local");

    const response = await supertest(harness.app)
      .post(REGISTER)
      .send({ email: "shared-4@machxi.local", password: "Str0ng!Passphrase" })
      .expect(429);

    expect(response.body.error.code).toBe("RATE_LIMITED");
  });
});

describe("the Google start limit", () => {
  let harness: TestApp;

  beforeAll(() => {
    // No seed: a start reads no account, and neither does a refused login.
    harness = createTestApp(withLimits({ loginMax: 2 }));
  });

  afterAll(async () => {
    await harness.close();
  });

  const START = "/api/v1/public/auth/google/start";

  it("refuses the third start from one source, on login's number in a counter of its own", async () => {
    // ADR-0072 §2: a start costs the API a signature and Google a redirect,
    // and there is no address yet to key on — so the source alone.
    await supertest(harness.app).post(START).send({}).expect(200);
    await supertest(harness.app).post(START).send({}).expect(200);

    const response = await supertest(harness.app)
      .post(START)
      .send({})
      .expect(429);

    expect(response.body.error.code).toBe("RATE_LIMITED");

    // A counter of its own: the other limiters keyed on the source alone
    // share the number and the key, and must not share the count
    // (`D19.2`'s `code-reviewer` — the login limiter keys on the address as
    // well, so it could never have collided).
    const lookup = await supertest(harness.app)
      .post("/api/v1/public/invitations/lookup")
      .send({ token: "never-minted" });

    expect(lookup.status).not.toBe(429);
  });

  it("gives the callback a counter of its own on the same number", async () => {
    // Each callback carrying a valid cookie is a request to Google's token
    // endpoint, and the sealed transaction is single-use only in an honest
    // browser (ADR-0072 §2, amended at `D19.2`). The start budget spent above
    // does not touch it.
    const CALLBACK = "/api/v1/public/auth/google/callback";

    await supertest(harness.app).get(CALLBACK).expect(302);
    await supertest(harness.app).get(CALLBACK).expect(302);

    const response = await supertest(harness.app).get(CALLBACK).expect(429);

    expect(response.body.error.code).toBe("RATE_LIMITED");
  });
});

describe("the set-password link limit", () => {
  let harness: TestApp;

  beforeAll(async () => {
    harness = createTestApp(
      withLimits({ passwordResetMax: 2, mailboxMax: 100_000 }),
    );
    await resetAndSeed({ db: harness.db, hasher: harness.container.hasher });
  });

  afterAll(async () => {
    await harness.close();
  });

  it("refuses the third ask from one account in the hour, in a counter of its own", async () => {
    // ADR-0072 §3, amended at `D19.4`: the recovery budget's number, keyed on
    // the account — whose own address is the only recipient — and counted
    // apart from `forgot`'s, so neither spends the other.
    const { accessToken } = await login(harness.app, "user", {
      email: FIXTURE_USERS.active,
      password: FIXTURE_PASSWORD,
    });
    const setLink = () =>
      supertest(harness.app)
        .post("/api/v1/user/profile/password/set-link")
        .set("Authorization", `Bearer ${accessToken}`);

    await setLink().expect(202);
    await setLink().expect(202);

    const response = await setLink().expect(429);

    expect(response.body.error.code).toBe("RATE_LIMITED");

    const retryAfter = Number(response.headers["retry-after"]);

    expect(retryAfter).toBeGreaterThan(AN_HOUR - 120);

    await supertest(harness.app)
      .post(FORGOT)
      .send({ email: FIXTURE_USERS.active })
      .expect(202);
  });
});
