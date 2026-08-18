import { describe, expect, it } from "vitest";

import { accessLogLevel, resolveRequestId } from "../http-logger.js";

/**
 * ADR-0005: an inbound `X-Request-Id` is honoured only in a bounded, safe
 * shape; anything else is replaced rather than rejected, because a bad
 * correlation id is not worth failing a request over.
 */
describe("resolveRequestId", () => {
  it.each([
    ["a hex trace id", "9f2c4a1b8e7d6c5f"],
    ["a UUID", "0197e2a0-0000-7000-8000-000000000000"],
    ["the shortest accepted id", "abcd1234"],
    ["the longest accepted id", "a".repeat(64)],
  ])("keeps %s", (_label, id) => {
    expect(resolveRequestId(id)).toBe(id);
  });

  it.each([
    ["nothing", undefined],
    ["an empty string", ""],
    ["too few characters", "abc"],
    ["more than 64 characters", "a".repeat(65)],
    ["a space", "abcd 1234"],
    ["a newline, which would forge a log line", "abcd1234\nfake"],
    ["a semicolon", "abcd1234;drop"],
    ["a non-string", 12345],
  ])("mints a new id for %s", (_label, inbound) => {
    const id = resolveRequestId(inbound);

    expect(id).not.toBe(inbound);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("takes the first value of a repeated header", () => {
    expect(resolveRequestId(["abcd1234", "efgh5678"])).toBe("abcd1234");
  });

  it("mints time-ordered ids, so log lines sort by arrival", () => {
    // UUIDv7 (ADR-0006): the timestamp is the high-order prefix.
    const first = resolveRequestId(undefined);
    const second = resolveRequestId(undefined);

    expect(first < second).toBe(true);
  });
});

/**
 * ADR-0005: level by outcome, with successful health polling kept out of the
 * `info` stream so an orchestrator cannot drown the log.
 */
describe("accessLogLevel", () => {
  const level = (url: string, statusCode: number, failed = false): string =>
    accessLogLevel({ url, statusCode, failed });

  it("logs an ordinary success at info", () => {
    expect(level("/api/v1/admin/staff", 200)).toBe("info");
  });

  it("logs a client failure at warn", () => {
    expect(level("/api/v1/admin/staff", 404)).toBe("warn");
    expect(level("/api/v1/admin/staff", 401)).toBe("warn");
  });

  it("logs a server failure at error", () => {
    expect(level("/api/v1/admin/staff", 500)).toBe("error");
  });

  it("logs a request that threw at error whatever the status says", () => {
    expect(level("/api/v1/admin/staff", 200, true)).toBe("error");
  });

  it.each(["/health", "/health/live", "/health/ready"])(
    "drops a successful %s to debug",
    (url) => {
      expect(level(url, 200)).toBe("debug");
    },
  );

  it("keeps a failing health check at its real level", () => {
    // The only time anyone reads these lines.
    expect(level("/health/ready", 503)).toBe("error");
  });

  it("does not drop an ordinary route that merely starts similarly", () => {
    expect(level("/api/v1/user/healthcheck", 200)).toBe("info");
  });

  it("falls back to info when the url is unknown", () => {
    expect(
      accessLogLevel({ url: undefined, statusCode: 200, failed: false }),
    ).toBe("info");
  });
});
