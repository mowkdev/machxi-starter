import supertest from "supertest";
import { afterAll, describe, expect, it } from "vitest";

import { createTestApp, type TestApp } from "./support/app.js";

/**
 * CORS against the real app (ADR-0020 §CORS, ADR-0021).
 *
 * Driven through `createApp` rather than by unit-testing `corsOrigin` alone,
 * because the defect this covers was never in the translation — it was that
 * nothing translated. `config.http.corsOrigins` went into `cors()` unchanged,
 * the middleware compared `"*"` to the `Origin` header as a literal string, and
 * `CORS_ORIGINS=*` therefore allowed nothing while reading like it allowed
 * everything. Only a test that reads the response header can tell those apart.
 *
 * `/health/live` is the probe: it needs no principal, sits outside every
 * limiter (ADR-0016), and this file cares about a header rather than a body.
 */

const ORIGIN = "http://localhost:3001";
const OTHER_ORIGIN = "http://evil.example.com";

/** An app whose only difference from the deployed one is its allow-list. */
const appWithOrigins = (corsOrigins: readonly string[]): TestApp =>
  createTestApp({
    config: (config) => ({
      ...config,
      http: { ...config.http, corsOrigins },
    }),
  });

describe("CORS allow-list", () => {
  const harnesses: TestApp[] = [];

  const harness = (corsOrigins: readonly string[]): TestApp => {
    const created = appWithOrigins(corsOrigins);

    harnesses.push(created);

    return created;
  };

  afterAll(async () => {
    await Promise.all(harnesses.map((created) => created.close()));
  });

  const probe = (created: TestApp, origin: string) =>
    supertest(created.app).get("/health/live").set("Origin", origin);

  describe("with an explicit allow-list", () => {
    it("allows an origin on the list", async () => {
      const response = await probe(harness([ORIGIN]), ORIGIN).expect(200);

      expect(response.headers["access-control-allow-origin"]).toBe(ORIGIN);
      expect(response.headers["access-control-allow-credentials"]).toBe("true");
    });

    it("does not allow an origin that is not on it", async () => {
      const response = await probe(harness([ORIGIN]), OTHER_ORIGIN).expect(200);

      // `cors` omits the header rather than denying the request: the request
      // is served, and the *browser* is what refuses to hand the response to
      // the page. A missing header is the denial.
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });

  describe("with the wildcard", () => {
    /**
     * The regression this file exists for. Before D2.2 the assertion below
     * failed: `"*"` was compared as a literal string, matched nothing, and the
     * header was absent — so the most permissive setting in `.env` produced
     * the most restrictive behaviour in the browser.
     */
    it("reflects any origin", async () => {
      const created = harness(["*"]);

      const first = await probe(created, ORIGIN).expect(200);
      const second = await probe(created, OTHER_ORIGIN).expect(200);

      expect(first.headers["access-control-allow-origin"]).toBe(ORIGIN);
      expect(second.headers["access-control-allow-origin"]).toBe(OTHER_ORIGIN);
    });

    it("reflects rather than echoing a literal `*`, so credentials work", async () => {
      const response = await probe(harness(["*"]), ORIGIN).expect(200);

      // The CORS specification forbids a literal `*` on a credentialed
      // response, and `credentials: true` is set for the future cookie
      // transport (ADR-0020, ADR-0029). Reflection is what keeps the two
      // compatible; echoing `*` here would make every browser reject the
      // response.
      //
      // Asserted as an equality rather than as `not.toBe("*")`: the absent
      // header this file exists to catch is also "not `*`", so the negative
      // form passes against the very bug being tested.
      expect(response.headers["access-control-allow-origin"]).toBe(ORIGIN);
      expect(response.headers["access-control-allow-credentials"]).toBe("true");
    });

    it("wins over any other entry in the list", async () => {
      const response = await probe(harness([ORIGIN, "*"]), OTHER_ORIGIN).expect(
        200,
      );

      expect(response.headers["access-control-allow-origin"]).toBe(
        OTHER_ORIGIN,
      );
    });
  });

  describe("with an empty allow-list", () => {
    it("allows no browser origin at all", async () => {
      const response = await probe(harness([]), ORIGIN).expect(200);

      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("still serves the request, because CORS is a browser control", async () => {
      // No `Origin` header: a non-browser client is unaffected by any of this.
      const response = await supertest(harness([]).app)
        .get("/health/live")
        .expect(200);

      expect(response.body.data.status).toBe("ok");
    });
  });
});
