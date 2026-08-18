import { createLogger } from "@repo/logger";
import express from "express";
import supertest from "supertest";
import { describe, expect, it } from "vitest";

import { getContext } from "../../context/index.js";
import { createContextMiddleware } from "../context.js";
import { createHttpLogger } from "../http-logger.js";

/**
 * ADR-0010: `req.ctx` is built once, carries the request id `pino-http` already
 * minted, and is the same object `getContext()` returns further down the chain.
 */

const probeApp = () => {
  const logger = createLogger({ level: "silent" });
  const app = express();

  app.use(createHttpLogger(logger));
  app.use(createContextMiddleware());
  app.get("/probe", (req, res) => {
    const ambient = getContext();

    res.status(200).json({
      requestId: req.ctx.requestId,
      sameObject: ambient === req.ctx,
      principal: req.ctx.principal,
      locale: req.ctx.locale,
      ip: req.ctx.ip,
      userAgent: req.ctx.userAgent,
      startedAt: req.ctx.startedAt,
    });
  });

  return app;
};

describe("createContextMiddleware", () => {
  it("carries the id pino-http minted and echoed", async () => {
    const response = await supertest(probeApp()).get("/probe").expect(200);

    expect(response.body.requestId).toBe(response.headers["x-request-id"]);
  });

  it("makes getContext() return the very object on the request", async () => {
    // Two mechanisms, one context — ADR-0010 relies on infrastructure code
    // reaching the same object a controller passes to a service explicitly.
    const response = await supertest(probeApp()).get("/probe").expect(200);

    expect(response.body.sameObject).toBe(true);
  });

  it("records ip and user agent, which the session audit trail needs", async () => {
    const response = await supertest(probeApp())
      .get("/probe")
      .set("User-Agent", "machxi-tests/1.0")
      .expect(200);

    expect(response.body.userAgent).toBe("machxi-tests/1.0");
    expect(typeof response.body.ip).toBe("string");
  });

  it("starts with no principal and the default locale", async () => {
    const response = await supertest(probeApp()).get("/probe").expect(200);

    expect(response.body.principal).toBeNull();
    expect(response.body.locale).toBe("en");
  });

  it("stamps a start time so durations can be measured", async () => {
    const response = await supertest(probeApp()).get("/probe").expect(200);

    expect(response.body.startedAt).toBeGreaterThan(0);
  });

  it("keeps concurrent requests on their own contexts", async () => {
    const app = probeApp();

    const responses = await Promise.all([
      supertest(app).get("/probe").expect(200),
      supertest(app).get("/probe").expect(200),
      supertest(app).get("/probe").expect(200),
    ]);

    const ids = responses.map((response) => response.body.requestId as string);

    expect(new Set(ids).size).toBe(3);
    expect(
      responses.every((response) => response.body.sameObject === true),
    ).toBe(true);
  });
});
