import { createLogger } from "@repo/logger";
import express from "express";
import supertest from "supertest";
import { describe, expect, it } from "vitest";

import { createHttpLogger } from "../http-logger.js";

/**
 * The access log as it is actually emitted (ADR-0005) — the pure level mapping
 * is covered next door; this asserts that `pino-http` is wired to it, that the
 * completion line carries the request id, and that it carries nothing else.
 */

interface Line {
  level: number;
  msg: string;
  req?: { id?: string; method?: string; url?: string; headers?: unknown };
  res?: { statusCode?: number; headers?: unknown };
  responseTime?: number;
}

const appWithLogger = () => {
  const lines: Line[] = [];
  const logger = createLogger({
    level: "trace",
    destination: {
      write: (line: string) => {
        lines.push(JSON.parse(line) as Line);
      },
    },
  });

  const app = express();

  app.use(createHttpLogger(logger));
  app.get("/health/ready", (_req, res) => {
    res.status(200).end();
  });
  app.get("/api/v1/thing", (_req, res) => {
    res.status(200).end();
  });
  app.get("/api/v1/missing", (_req, res) => {
    res.status(404).end();
  });

  return { app, lines };
};

const completion = (lines: Line[]): Line => {
  const line = lines.find((entry) => entry.msg === "request completed");

  expect(line).toBeDefined();

  return line!;
};

describe("createHttpLogger", () => {
  it("logs one completion line per request", async () => {
    const { app, lines } = appWithLogger();

    await supertest(app).get("/api/v1/thing").expect(200);

    expect(
      lines.filter((line) => line.msg === "request completed"),
    ).toHaveLength(1);
  });

  it("carries method, url, status, duration and the request id", async () => {
    const { app, lines } = appWithLogger();

    const response = await supertest(app).get("/api/v1/thing").expect(200);
    const line = completion(lines);

    expect(line.req?.method).toBe("GET");
    expect(line.req?.url).toBe("/api/v1/thing");
    expect(line.res?.statusCode).toBe(200);
    expect(line.responseTime).toBeGreaterThanOrEqual(0);
    expect(line.req?.id).toBe(response.headers["x-request-id"]);
  });

  it("does not dump request or response headers", async () => {
    // The redaction list would otherwise have to keep pace with every header
    // that might one day carry a credential (ADR-0005).
    const { app, lines } = appWithLogger();

    await supertest(app)
      .get("/api/v1/thing")
      .set("Authorization", "Bearer super-secret-token")
      .expect(200);

    const line = completion(lines);

    expect(line.req?.headers).toBeUndefined();
    expect(line.res?.headers).toBeUndefined();
    expect(JSON.stringify(line)).not.toContain("super-secret-token");
  });

  it("logs an ordinary success at info", async () => {
    const { app, lines } = appWithLogger();

    await supertest(app).get("/api/v1/thing").expect(200);

    expect(completion(lines).level).toBe(30);
  });

  it("logs a client failure at warn", async () => {
    const { app, lines } = appWithLogger();

    await supertest(app).get("/api/v1/missing").expect(404);

    expect(completion(lines).level).toBe(40);
  });

  it("drops a successful health check to debug", async () => {
    const { app, lines } = appWithLogger();

    await supertest(app).get("/health/ready").expect(200);

    expect(completion(lines).level).toBe(20);
  });

  it("still sees the full path when the route is mounted on a sub-router", async () => {
    // Express rewrites `req.url` to the mount-relative path while a sub-router
    // is dispatching, which is how `/health/ready` can look like `/ready` to
    // anything that reads it at the wrong moment. `createRoutes` mounts health
    // exactly this way, so the level mapping has to survive it.
    const lines: Line[] = [];
    const logger = createLogger({
      level: "trace",
      destination: {
        write: (line: string) => {
          lines.push(JSON.parse(line) as Line);
        },
      },
    });

    const health = express.Router();

    health.get("/ready", (_req, res) => {
      // Async, like the real controller: it awaits the database first.
      setTimeout(() => {
        res.status(200).end();
      }, 5);
    });

    const routes = express.Router();

    routes.use("/health", health);

    const app = express();

    app.use(createHttpLogger(logger));
    app.use(routes);

    await supertest(app).get("/health/ready").expect(200);

    const line = completion(lines);

    expect(line.req?.url).toBe("/health/ready");
    expect(line.level).toBe(20);
  });
});
