import { createLogger } from "@repo/logger";
import { describe, expect, it } from "vitest";

import { createRequestContext, type Principal } from "../../context/index.js";
import {
  accessLogLevel,
  principalProps,
  resolveRequestId,
  type LoggedRequest,
} from "../http-logger.js";

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

  it.each(["/health-report", "/healthz-admin", "/api/v1/user/healthcheck"])(
    "does not drop %s, which merely starts similarly",
    (url) => {
      expect(level(url, 200)).toBe("info");
    },
  );

  it("falls back to info when the url is unknown", () => {
    expect(
      accessLogLevel({ url: undefined, statusCode: 200, failed: false }),
    ).toBe("info");
  });
});

/**
 * ADR-0005 names what the completion line carries, and ADR-0057 §6 adds one
 * field to it: every request served under impersonation must be findable in
 * the logs by the **operator's** id, not only by the account it ran as. That
 * matters most for the requests the audit table deliberately does not take —
 * the reads, which ADR-0058 logs rather than audits.
 */
describe("principalProps", () => {
  const withPrincipal = (principal: Principal | null): LoggedRequest => {
    const ctx = createRequestContext({
      requestId: "req-1",
      logger: createLogger({ level: "silent" }),
    });

    ctx.principal = principal;

    return { ctx } as LoggedRequest;
  };

  it("says nothing at all before the request is authenticated", () => {
    expect(principalProps(withPrincipal(null))).toEqual({});
    expect(principalProps({} as LoggedRequest)).toEqual({});
  });

  it("carries the principal and its population on an ordinary session", () => {
    expect(
      principalProps(
        withPrincipal({
          kind: "user",
          id: "user-9",
          roles: ["customer"],
          sessionId: "session-1",
        }),
      ),
    ).toEqual({ principalId: "user-9", population: "user" });
  });

  it("carries both identities on an impersonated one", () => {
    expect(
      principalProps(
        withPrincipal({
          kind: "user",
          id: "user-9",
          roles: ["customer"],
          sessionId: "session-1",
          impersonatedBy: "staff-1",
        }),
      ),
    ).toEqual({
      principalId: "user-9",
      population: "user",
      // The staff member's id and never their address: the wire principal is
      // where the email lives, and an access line is not the place for it.
      impersonatedBy: "staff-1",
    });
  });

  it("never puts an actor on a staff principal", () => {
    // A staff session is never impersonated (ADR-0057 §4), and the field is on
    // the customer shape alone — so this is a type-level guarantee restated as
    // a runtime one.
    expect(
      principalProps(
        withPrincipal({
          kind: "staff",
          id: "staff-1",
          roles: ["admin"],
          sessionId: "session-1",
        }),
      ),
    ).toEqual({ principalId: "staff-1", population: "staff" });
  });
});
