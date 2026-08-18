import { errorEnvelopeSchema } from "@repo/contracts";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestApp, type TestApp } from "./support/app.js";

/**
 * The middleware order, asserted end to end (ADR-0011 §Consequences).
 *
 * An unknown route, a malformed body and a too-large body each have to come
 * back as the one error envelope with a request id — which is only true if
 * `pino-http`, the context middleware, the body parser, the not-found handler
 * and the error handler are mounted in the order `app.ts` fixes.
 */
describe("error envelope", () => {
  let harness: TestApp;

  beforeAll(() => {
    harness = createTestApp();
  });

  afterAll(async () => {
    await harness.close();
  });

  const request = () => supertest(harness.app);

  it("answers an unknown route with ROUTE_NOT_FOUND", async () => {
    const response = await request().get("/nope").expect(404);

    expect(errorEnvelopeSchema.safeParse(response.body).success).toBe(true);
    expect(response.body.error.code).toBe("ROUTE_NOT_FOUND");
    expect(response.body.success).toBe(false);
  });

  it("answers an unknown route under /api/v1 the same way", async () => {
    // The segment routers are mounted but empty until step 8; an unmatched
    // path must still fall through to the same handler, not to Express's
    // HTML default page.
    const response = await request()
      .get("/api/v1/admin/does-not-exist")
      .expect(404);

    expect(response.body.error.code).toBe("ROUTE_NOT_FOUND");
    expect(response.headers["content-type"]).toMatch(/application\/json/);
  });

  it("correlates the failure with a log line", async () => {
    const response = await request().get("/nope").expect(404);

    expect(response.body.meta.requestId).toBe(response.headers["x-request-id"]);
    expect(response.body.meta.requestId).not.toBe("");
  });

  it("answers a malformed JSON body with MALFORMED_JSON", async () => {
    const response = await request()
      .post("/api/v1/public/anything")
      .set("Content-Type", "application/json")
      .send("{ not json")
      .expect(400);

    expect(response.body.error.code).toBe("MALFORMED_JSON");
  });

  it("answers an oversized body with PAYLOAD_TOO_LARGE", async () => {
    const response = await request()
      .post("/api/v1/public/anything")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ blob: "x".repeat(1_100_000) }))
      .expect(413);

    expect(response.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("never sends a stack trace in the test environment", async () => {
    const response = await request()
      .post("/api/v1/public/anything")
      .set("Content-Type", "application/json")
      .send("{ not json")
      .expect(400);

    expect(response.body.error).not.toHaveProperty("debug");
  });
});

describe("query parsing", () => {
  let harness: TestApp;

  beforeAll(() => {
    harness = createTestApp();
  });

  afterAll(async () => {
    await harness.close();
  });

  it("builds nested objects from bracket syntax", async () => {
    // Express 5 defaults to the `simple` parser, which would deliver this as
    // one literal key and make every list endpoint reject it (ADR-0011,
    // ADR-0014). There is no list endpoint yet, so the parser itself is the
    // assertion.
    const { queryParser } = await import("../src/app.js");

    expect(queryParser("filter[status][in]=active,invited&limit=20")).toEqual({
      filter: { status: { in: "active,invited" } },
      limit: "20",
    });
  });

  it("stops parsing beyond the configured depth", async () => {
    const { queryParser } = await import("../src/app.js");
    const parsed = queryParser("a[b][c][d][e][f]=1") as Record<string, unknown>;

    // Everything past `depth: 3` collapses into the key rather than being
    // expanded, which is what bounds the work a crafted query string can cause.
    expect(JSON.stringify(parsed)).toContain("[e][f]");
  });
});

describe("CORS", () => {
  let harness: TestApp;

  beforeAll(() => {
    harness = createTestApp();
  });

  afterAll(async () => {
    await harness.close();
  });

  it("allows an origin on the list and exposes the request id header", async () => {
    const response = await supertest(harness.app)
      .get("/health/live")
      .set("Origin", "http://localhost:3001")
      .expect(200);

    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://localhost:3001",
    );
    expect(response.headers["access-control-expose-headers"]).toContain(
      "X-Request-Id",
    );
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("sends no allow-origin for an origin that is not on the list", async () => {
    const response = await supertest(harness.app)
      .get("/health/live")
      .set("Origin", "http://evil.example")
      .expect(200);

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
