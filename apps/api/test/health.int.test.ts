import {
  declaredErrorEnvelopeSchema,
  successEnvelopeSchema,
} from "@repo/contracts";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { createTestApp, type TestApp } from "./support/app.js";

/**
 * `/health` against a real Postgres (ADR-0016, ADR-0021).
 *
 * The whole chain is exercised — `createApp(buildContainer(…))` — so what these
 * assertions cover is not just the handler but the middleware order, the
 * envelope and the headers ADR-0020 requires.
 */

const healthSchema = successEnvelopeSchema(
  z.object({
    status: z.enum(["ok", "degraded", "down"]),
    version: z.string(),
    uptimeSeconds: z.number(),
    timestamp: z.iso.datetime(),
    checks: z.record(z.string(), z.unknown()),
  }),
);

describe("health endpoints", () => {
  let harness: TestApp;

  beforeAll(() => {
    harness = createTestApp();
  });

  afterAll(async () => {
    await harness.close();
  });

  const request = () => supertest(harness.app);

  it("answers liveness without touching the database", async () => {
    const response = await request().get("/health/live").expect(200);

    expect(healthSchema.safeParse(response.body).success).toBe(true);
    expect(response.body.data.status).toBe("ok");
    // Liveness reports no checks at all — a bad database must not restart the
    // process.
    expect(response.body.data.checks).toEqual({});
  });

  it("answers readiness with the database check", async () => {
    const response = await request().get("/health/ready").expect(200);

    expect(healthSchema.safeParse(response.body).success).toBe(true);
    expect(response.body.data.checks.database).toMatchObject({ status: "ok" });
    expect(response.body.data.checks.database.latencyMs).toBeGreaterThanOrEqual(
      0,
    );
  });

  it("serves the human view at /health", async () => {
    const response = await request().get("/health").expect(200);

    expect(response.body.data.version).toBe(harness.config.app.version);
    expect(response.body.data.checks.database.status).toBe("ok");
  });

  it("forbids caching a health answer", async () => {
    await request().get("/health/ready").expect("Cache-Control", "no-store");
  });

  it("echoes a request id that correlates the body with the log line", async () => {
    const response = await request().get("/health/live").expect(200);

    expect(response.headers["x-request-id"]).toBe(response.body.meta.requestId);
  });

  it("honours a well-formed inbound request id", async () => {
    const response = await request()
      .get("/health/live")
      .set("X-Request-Id", "trace-0123456789")
      .expect(200);

    expect(response.body.meta.requestId).toBe("trace-0123456789");
  });

  it("replaces an inbound id that could forge a log line", async () => {
    const response = await request()
      .get("/health/live")
      .set("X-Request-Id", "bad id with spaces")
      .expect(200);

    expect(response.body.meta.requestId).not.toBe("bad id with spaces");
  });

  it("does not advertise the framework or emit a validator", async () => {
    const response = await request().get("/health/live").expect(200);

    expect(response.headers["x-powered-by"]).toBeUndefined();
    expect(response.headers.etag).toBeUndefined();
  });

  it("sends the helmet security headers", async () => {
    const response = await request().get("/health/live").expect(200);

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBeDefined();
  });
});

describe("readiness with an unreachable database", () => {
  let harness: TestApp;

  beforeAll(() => {
    // A port nothing listens on: the pool is created lazily, so this fails at
    // the first `select 1` — which is exactly what readiness runs.
    harness = createTestApp({
      config: (config) => ({
        ...config,
        db: {
          ...config.db,
          url: "postgres://nobody:nobody@127.0.0.1:1/machxi",
        },
      }),
    });
  });

  afterAll(async () => {
    await harness.close().catch(() => undefined);
  });

  it("answers 503 with the standard error envelope", async () => {
    const response = await supertest(harness.app)
      .get("/health/ready")
      .expect(503);

    expect(declaredErrorEnvelopeSchema.safeParse(response.body).success).toBe(
      true,
    );
    expect(response.body.error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("names the failing indicator without leaking the connection target", async () => {
    const response = await supertest(harness.app)
      .get("/health/ready")
      .expect(503);

    expect(response.body.error.details).toEqual([
      { code: "database", message: expect.stringContaining("unreachable") },
    ]);
    expect(JSON.stringify(response.body)).not.toContain("nobody");
    expect(JSON.stringify(response.body)).not.toContain("127.0.0.1");
  });

  it("still answers liveness, so the process is not restarted", async () => {
    await supertest(harness.app).get("/health/live").expect(200);
  });
});
