import type { Request } from "express";
import { describe, expect, it } from "vitest";

import { UNMATCHED_ROUTE, routeLabel, statusClass } from "../index.js";

/**
 * ADR-0066 §2: the label is the **route pattern**, never the path.
 *
 * An id in a label is an unbounded-cardinality bug — one time series per user,
 * per session, per audit row — so this is the rule the endpoint's cost depends
 * on rather than a formatting preference.
 */

const request = (originalUrl: string, path?: string) =>
  ({
    originalUrl,
    // Empty on purpose: Express restores it while unwinding out of a mounted
    // router, so `routeLabel` must not read it (see the function's note).
    baseUrl: "",
    ...(path === undefined ? {} : { route: { path } }),
  }) as Request;

describe("routeLabel", () => {
  it("replaces the concrete tail with the pattern, ids unexpanded", () => {
    expect(
      routeLabel(
        request(
          "/api/v1/admin/users/018f0000-0000-7000-8000-000000000000/password",
          "/:id/password",
        ),
      ),
    ).toBe("/api/v1/admin/users/:id/password");
  });

  it("collapses a mount point's own root", () => {
    // `router.get('/')` under a mount would otherwise be a second series for
    // the same endpoint the moment anything reported it without the slash.
    expect(routeLabel(request("/api/v1/admin/staff", "/"))).toBe(
      "/api/v1/admin/staff",
    );
  });

  it("ignores the query string", () => {
    expect(routeLabel(request("/api/v1/admin/staff?limit=20", "/"))).toBe(
      "/api/v1/admin/staff",
    );
  });

  it("does not depend on baseUrl, which unwinding clears", () => {
    // The bug this rule exists to prevent: the same endpoint labelled
    // `/api/v1/admin/auth/login` when it succeeds and `/login` when it fails.
    expect(routeLabel(request("/api/v1/admin/auth/login", "/login"))).toBe(
      "/api/v1/admin/auth/login",
    );
  });

  it("folds the case an Express route match tolerates", () => {
    // Express matches paths case-insensitively by default, so `/HeAlTh/LiVe`
    // reaches its handler and `originalUrl` keeps the caller's spelling. Left
    // alone, the prefix would be an attacker-chosen label value on a route
    // that sits above every rate limiter, and every value costs a counter plus
    // twelve histogram children that are never evicted.
    expect(routeLabel(request("/HeAlTh/LiVe", "/live"))).toBe("/health/live");
    expect(routeLabel(request("/MeTrIcS", "/"))).toBe("/metrics");
  });

  it("refuses a prefix segment that does not look like one of our mounts", () => {
    // The bound on the label set is a property of this function rather than of
    // the route table: anything outside the API's own URL vocabulary is one
    // bounded series, not a new one.
    expect(routeLabel(request("/%41pi/v1/admin/staff", "/"))).toBe(
      UNMATCHED_ROUTE,
    );
    expect(routeLabel(request("/api/v1/ad min/staff", "/"))).toBe(
      UNMATCHED_ROUTE,
    );
  });

  it("labels a request that matched no route once", () => {
    expect(routeLabel(request("/", undefined))).toBe(UNMATCHED_ROUTE);
    expect(routeLabel(request("/api/v1/admin/users/018f-not-a-route"))).toBe(
      UNMATCHED_ROUTE,
    );
  });
});

describe("statusClass", () => {
  it("reports the family, not the code", () => {
    expect(statusClass(200)).toBe("2xx");
    expect(statusClass(404)).toBe("4xx");
    expect(statusClass(503)).toBe("5xx");
  });
});
