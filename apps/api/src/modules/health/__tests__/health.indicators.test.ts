import { describe, expect, it, vi } from "vitest";

import type { DbClient } from "../../../core/db/index.js";
import { createDbIndicator, sanitiseDbError } from "../health.indicators.js";

/**
 * ADR-0016: health responses are unauthenticated, so a driver message — which
 * names hosts, ports and roles — must never reach one.
 */

const clientWith = (ping: () => Promise<void>): DbClient =>
  ({ ping }) as unknown as DbClient;

const refused = () =>
  Object.assign(new Error("connect ECONNREFUSED 10.0.3.12:5432"), {
    code: "ECONNREFUSED",
  });

describe("sanitiseDbError", () => {
  it("keeps the operational signal, which is the error code", () => {
    expect(sanitiseDbError(refused())).toBe("unreachable (ECONNREFUSED)");
  });

  it("drops the host, port and role the driver put in its message", () => {
    const message = sanitiseDbError(
      Object.assign(new Error("password authentication failed for machxi"), {
        code: "28P01",
      }),
    );

    expect(message).not.toContain("machxi");
    expect(message).toBe("unreachable (28P01)");
  });

  it.each([
    ["an error with no code", new Error("something")],
    ["a non-error", "boom"],
    ["null", null],
  ])("falls back to a bare reason for %s", (_label, error) => {
    expect(sanitiseDbError(error)).toBe("unreachable");
  });
});

describe("createDbIndicator", () => {
  it("is registered as a critical dependency", () => {
    const indicator = createDbIndicator(clientWith(() => Promise.resolve()));

    expect(indicator.name).toBe("database");
    expect(indicator.critical).toBe(true);
  });

  it("reports ok when the ping succeeds", async () => {
    const ping = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    expect(await createDbIndicator(clientWith(ping)).check()).toEqual({
      status: "ok",
    });
    expect(ping).toHaveBeenCalledOnce();
  });

  it("reports down with a sanitised reason when it fails", async () => {
    const indicator = createDbIndicator(
      clientWith(() => Promise.reject(refused())),
    );

    expect(await indicator.check()).toEqual({
      status: "down",
      message: "unreachable (ECONNREFUSED)",
    });
  });
});
