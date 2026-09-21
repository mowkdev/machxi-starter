import { declaredErrorEnvelopeSchema } from "@repo/contracts";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/core/config/index.js";
import type { ErrorReport } from "../src/core/reporting/index.js";
import { bearer, login } from "./support/actors.js";
import { createTestApp, type TestApp } from "./support/app.js";
import { resetAndSeed, superAdmin } from "./support/seed.js";

/**
 * ADR-0066 §2 and §3, end to end: the scrape endpoint and the reporting hook.
 *
 * Both are seams a default clone leaves off, which is precisely why they are
 * tested here — an off-by-default control is the kind that is discovered to be
 * broken on the day it is first turned on.
 */

const METRICS_TOKEN = "m".repeat(32);

const withToken = (token: string | undefined) => ({
  config: (config: AppConfig): AppConfig => ({
    ...config,
    metrics: { token },
  }),
});

describe("GET /metrics", () => {
  let harness: TestApp;

  beforeAll(() => {
    harness = createTestApp(withToken(METRICS_TOKEN));
  });

  afterAll(async () => {
    await harness.close();
  });

  const request = () => supertest(harness.app);

  it("answers 200 with the bearer token", async () => {
    const response = await request()
      .get("/metrics")
      .set("Authorization", `Bearer ${METRICS_TOKEN}`)
      .expect(200);

    expect(response.headers["content-type"]).toMatch(/text\/plain/);
    // The default process metrics and the HTTP instrumentation, on one
    // registry built per container.
    expect(response.text).toContain("http_requests_total");
    expect(response.text).toContain("process_cpu_seconds_total");
    // A scrape must not be cached by anything between the API and the scraper.
    expect(response.headers["cache-control"]).toContain("no-store");
  });

  it("answers 401 without it, in the error envelope", async () => {
    const response = await request().get("/metrics").expect(401);

    expect(declaredErrorEnvelopeSchema.safeParse(response.body).success).toBe(
      true,
    );
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("answers 401 for a wrong token and for the wrong scheme", async () => {
    await request()
      .get("/metrics")
      .set("Authorization", `Bearer ${"n".repeat(32)}`)
      .expect(401);

    // Basic auth carrying the right secret is still not a bearer token.
    await request()
      .get("/metrics")
      .set("Authorization", `Basic ${METRICS_TOKEN}`)
      .expect(401);
  });

  it("labels by route pattern, so an id never becomes a time series", async () => {
    await resetAndSeed({
      db: harness.db,
      hasher: harness.hasher,
    });

    const tokens = await login(harness.app, "staff", superAdmin());
    const id = "018f0000-0000-7000-8000-000000000000";

    // Signed in, because a request refused by the segment's router-level
    // `authenticate` never reaches a route at all — see the `unmatched` case
    // below, which is the honest label for it.
    await request()
      .get(`/api/v1/admin/users/${id}`)
      .set("Authorization", bearer(tokens.accessToken))
      .expect(404);

    const response = await request()
      .get("/metrics")
      .set("Authorization", `Bearer ${METRICS_TOKEN}`)
      .expect(200);

    expect(response.text).not.toContain(id);
    expect(response.text).toContain('route="/api/v1/admin/users/:id"');
  });

  it("labels a guard's refusal `unmatched`, because no route ran", async () => {
    // `authenticate` is router-level middleware on the segment (ADR-0019), so
    // an anonymous caller is refused before Express has matched a route and
    // `req.route` never exists. Counting it under the endpoint it was aiming
    // at would be a guess; `unmatched` is what is actually known, and it is
    // one bounded series rather than one per attempted path.
    await request()
      .get("/api/v1/admin/users/018f1111-0000-7000-8000-000000000000")
      .expect(401);

    const response = await request()
      .get("/metrics")
      .set("Authorization", `Bearer ${METRICS_TOKEN}`)
      .expect(200);

    expect(response.text).toContain('route="unmatched"');
  });
});

describe("GET /metrics without a token", () => {
  let harness: TestApp;

  beforeAll(() => {
    harness = createTestApp(withToken(undefined));
  });

  afterAll(async () => {
    await harness.close();
  });

  it("is open, which the config schema permits outside production only", async () => {
    // The refusal is a *startup* failure (`METRICS_TOKEN` is required when
    // `NODE_ENV=production`), not a runtime one — so the endpoint itself is
    // unauthenticated here, and the config test is what proves production
    // cannot reach this state.
    await supertest(harness.app).get("/metrics").expect(200);
  });
});

describe("/metrics is outside the rate limiters", () => {
  let harness: TestApp;

  beforeAll(() => {
    harness = createTestApp({
      config: (config) => ({
        ...config,
        rateLimit: { ...config.rateLimit, globalMax: 1 },
        metrics: { token: undefined },
      }),
    });
  });

  afterAll(async () => {
    await harness.close();
  });

  it("still answers once the global budget is spent", async () => {
    const request = () => supertest(harness.app);

    await request().get("/api/v1/public/nope").expect(404);
    await request().get("/api/v1/public/nope").expect(429);

    // ADR-0016's argument, applied to the scrape: an instance whose /metrics
    // answers 429 looks down to the monitoring that exists to say it is up.
    await request().get("/metrics").expect(200);
  });
});

describe("the error-reporting hook", () => {
  const report = vi.fn<(report: ErrorReport) => void>();
  let harness: TestApp;

  beforeAll(() => {
    harness = createTestApp({
      // A database nothing is listening on, so a route that queries fails with
      // a driver error — the unmapped kind that becomes `internal()` and a 500.
      config: (config) => ({
        ...config,
        db: { ...config.db, url: "postgres://nobody:nobody@127.0.0.1:1/x" },
      }),
      reporter: { report },
    });
  });

  afterAll(async () => {
    await harness.close().catch(() => undefined);
  });

  it("does not fire on a 4xx", async () => {
    await supertest(harness.app).get("/nope").expect(404);
    await supertest(harness.app)
      .post("/api/v1/admin/auth/login")
      .send({ email: "not-an-email" })
      .expect(400);

    // A 400, a 401 and a 404 are the API working. Reporting them buries the
    // crashes and ships user input to a third party (ADR-0066 §3).
    expect(report).not.toHaveBeenCalled();
  });

  it("fires once on a 5xx, with no request body", async () => {
    const response = await supertest(harness.app)
      .post("/api/v1/admin/auth/login")
      .send({ email: "someone@machxi.local", password: "hunter2-not-real" })
      .expect(500);

    expect(report).toHaveBeenCalledTimes(1);

    const [reported] = report.mock.calls[0] ?? [];

    expect(reported).toMatchObject({
      status: 500,
      method: "POST",
      route: "/api/v1/admin/auth/login",
      principal: null,
      requestId: response.body.meta.requestId,
    });
    // The seam's whole safety property: the fields are enumerated, and the
    // body — where the password is — is not among them.
    expect(JSON.stringify(Object.keys(reported ?? {}))).not.toContain("body");
    expect(JSON.stringify(reported)).not.toContain("hunter2-not-real");
  });

  it("leaves the response envelope untouched", async () => {
    const response = await supertest(harness.app)
      .post("/api/v1/admin/auth/login")
      .send({ email: "someone@machxi.local", password: "hunter2-not-real" })
      .expect(500);

    // The whole of the delta on ADR-0013: a client cannot tell whether a
    // deployment reports.
    expect(declaredErrorEnvelopeSchema.safeParse(response.body).success).toBe(
      true,
    );
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
    expect(response.body.error.message).toBe("Internal server error");
  });
});
