import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { carriesMetricsToken } from "../metrics.token.js";

/**
 * The one metrics-token check `/metrics` and `/health` share (ADR-0066 §2,
 * ADR-0084 §3). `timingSafeEqual` is wrapped, not replaced, so each case can
 * see what was compared: two fixed-width digests every time, never a length
 * check that returns early.
 */
const { timingSafeEqual } = vi.hoisted(() => ({
  timingSafeEqual: vi.fn<(a: Buffer, b: Buffer) => boolean>(),
}));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();

  timingSafeEqual.mockImplementation((a, b) => actual.timingSafeEqual(a, b));

  return { ...actual, timingSafeEqual };
});

const TOKEN = "t".repeat(40);

const request = (authorization?: string): Request =>
  ({
    get: (name: string) =>
      name.toLowerCase() === "authorization" ? authorization : undefined,
  }) as unknown as Request;

beforeEach(() => {
  timingSafeEqual.mockClear();
});

describe("carriesMetricsToken", () => {
  it("accepts the configured token as a bearer token", () => {
    expect(carriesMetricsToken(request(`Bearer ${TOKEN}`), TOKEN)).toBe(true);
  });

  it("a presented token of a different length is refused without comparing lengths first", () => {
    for (const presented of ["short", `${TOKEN}x`, TOKEN.slice(1), ""]) {
      timingSafeEqual.mockClear();

      expect(carriesMetricsToken(request(`Bearer ${presented}`), TOKEN)).toBe(
        false,
      );
      // Always reached, always on two 32-byte digests: the length of what was
      // presented never decides whether the comparison runs.
      expect(timingSafeEqual).toHaveBeenCalledTimes(1);

      const [a, b] = timingSafeEqual.mock.calls[0] ?? [];

      expect(a?.length).toBe(32);
      expect(b?.length).toBe(32);
    }
  });

  it("refuses a wrong token of the same length", () => {
    expect(
      carriesMetricsToken(request(`Bearer ${"u".repeat(40)}`), TOKEN),
    ).toBe(false);
  });

  it("refuses no header and another scheme without comparing", () => {
    expect(carriesMetricsToken(request(), TOKEN)).toBe(false);
    expect(carriesMetricsToken(request(`Basic ${TOKEN}`), TOKEN)).toBe(false);
    expect(timingSafeEqual).not.toHaveBeenCalled();
  });

  it("is false whatever is presented when no token is configured", () => {
    expect(carriesMetricsToken(request(`Bearer ${TOKEN}`), undefined)).toBe(
      false,
    );
  });
});
