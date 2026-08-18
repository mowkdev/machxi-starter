import { createLogger } from "@repo/logger";
import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "../../../core/config/index.js";
import { createRequestContext } from "../../../core/context/index.js";
import { isAppError, type AppError } from "../../../core/errors/index.js";
import { aggregateStatus, createHealthService } from "../health.service.js";
import type { HealthIndicator } from "../health.types.js";

/**
 * ADR-0016: liveness never touches a dependency, readiness does, and a
 * readiness failure travels as the standard error envelope rather than a third
 * response shape.
 */

const config = loadConfig({
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  JWT_ACCESS_SECRET: "a".repeat(32),
  APP_VERSION: "1.4.2",
  GIT_SHA: "a1b2c3d",
});

const ctx = createRequestContext({
  requestId: "r1",
  logger: createLogger({ level: "silent" }),
});

const okIndicator = (name = "database"): HealthIndicator => ({
  name,
  check: () => Promise.resolve({ status: "ok" }),
});

const downIndicator = (name = "database", critical = true): HealthIndicator => ({
  name,
  critical,
  check: () => Promise.resolve({ status: "down", message: "unreachable" }),
});

const service = (indicators: HealthIndicator[], overrides = {}) =>
  createHealthService({
    indicators,
    config,
    now: () => new Date("2026-08-18T10:00:00.000Z"),
    uptimeSeconds: () => 12_345.6,
    ...overrides,
  });

describe("live", () => {
  it("answers ok without consulting any indicator", () => {
    const check = vi.fn();
    const resource = service([{ name: "database", check }]).live(ctx);

    expect(resource.status).toBe("ok");
    expect(resource.checks).toEqual({});
    // A database outage must not restart the process: readiness is what takes
    // it out of the load balancer.
    expect(check).not.toHaveBeenCalled();
  });

  it("reports version, commit, uptime and a timestamp", () => {
    expect(service([]).live(ctx)).toMatchObject({
      version: "1.4.2",
      commit: "a1b2c3d",
      uptimeSeconds: 12_346,
      timestamp: "2026-08-18T10:00:00.000Z",
    });
  });
});

describe("ready", () => {
  it("reports each indicator with its latency", async () => {
    const resource = await service([okIndicator()]).ready(ctx);

    expect(resource.status).toBe("ok");
    expect(resource.checks.database).toMatchObject({ status: "ok" });
    expect(resource.checks.database?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("throws 503 SERVICE_UNAVAILABLE when a critical indicator is down", async () => {
    const error: unknown = await service([downIndicator()])
      .ready(ctx)
      .catch((caught: unknown) => caught);

    expect(isAppError(error)).toBe(true);
    expect((error as AppError).status).toBe(503);
    expect((error as AppError).code).toBe("SERVICE_UNAVAILABLE");
    expect((error as AppError).details).toEqual([
      { code: "database", message: "unreachable" },
    ]);
  });

  it("still serves traffic when only a non-critical indicator fails", async () => {
    const resource = await service([
      okIndicator("database"),
      downIndicator("cache", false),
    ]).ready(ctx);

    expect(resource.status).toBe("degraded");
    expect(resource.checks.cache?.status).toBe("down");
  });

  it("gives up on an indicator that hangs instead of holding the connection", async () => {
    const hanging: HealthIndicator = {
      name: "database",
      check: () => new Promise(() => undefined),
    };

    const error: unknown = await service([hanging], { checkTimeoutMs: 10 })
      .ready(ctx)
      .catch((caught: unknown) => caught);

    expect((error as AppError).details?.[0]?.message).toMatch(/no answer/);
  });

  it("treats an indicator that throws as down, without echoing its message", async () => {
    const throwing: HealthIndicator = {
      name: "database",
      check: () =>
        Promise.reject(new Error("connect ECONNREFUSED 10.0.3.12:5432")),
    };

    const error: unknown = await service([throwing])
      .ready(ctx)
      .catch((caught: unknown) => caught);

    expect(JSON.stringify((error as AppError).details)).not.toContain(
      "10.0.3.12",
    );
  });

  it("runs indicators in parallel, not one after another", async () => {
    const slow = (name: string): HealthIndicator => ({
      name,
      check: () =>
        new Promise((resolve) =>
          setTimeout(() => {
            resolve({ status: "ok" });
          }, 40),
        ),
    });

    const startedAt = performance.now();

    await service([slow("a"), slow("b"), slow("c")]).ready(ctx);

    expect(performance.now() - startedAt).toBeLessThan(120);
  });

  it("answers ok with no indicators registered at all", async () => {
    expect((await service([]).ready(ctx)).status).toBe("ok");
  });
});

describe("aggregateStatus", () => {
  const check = (status: "ok" | "down") => ({ status, latencyMs: 1 }) as const;

  it("is down when a critical indicator failed", () => {
    expect(
      aggregateStatus([
        { indicator: okIndicator(), check: check("down") },
        { indicator: okIndicator("cache"), check: check("ok") },
      ]),
    ).toBe("down");
  });

  it("is degraded when only a non-critical one failed", () => {
    expect(
      aggregateStatus([
        {
          indicator: { name: "cache", critical: false, check: vi.fn() },
          check: check("down"),
        },
      ]),
    ).toBe("degraded");
  });

  it("treats an indicator with no `critical` flag as critical", () => {
    // The safe default: a dependency nobody classified is assumed to matter.
    expect(
      aggregateStatus([{ indicator: okIndicator(), check: check("down") }]),
    ).toBe("down");
  });

  it("is ok when everything passed", () => {
    expect(
      aggregateStatus([{ indicator: okIndicator(), check: check("ok") }]),
    ).toBe("ok");
  });
});
