import { describe, expect, it } from "vitest";

import { assertTestDatabase, laneDatabaseUrl } from "../testing.js";

/**
 * The lane family of test databases (ADR-0082 §3) and the `_test` suffix
 * guard underneath it (ADR-0008 §Environment guardrails). Pure: no database.
 */

const testUrl =
  "postgres://machxi_owner:machxi_owner@localhost:5432/machxi_test";

const databaseOf = (url: string): string => new URL(url).pathname.slice(1);

describe("laneDatabaseUrl", () => {
  it("points a test URL at the lane's database and keeps everything else", () => {
    const url = laneDatabaseUrl(`${testUrl}?sslmode=disable`, "spike-d29-rls");

    expect(databaseOf(url)).toBe("machxi_spike-d29-rls_test");
    expect(new URL(url).username).toBe("machxi_owner");
    expect(new URL(url).password).toBe("machxi_owner");
    expect(new URL(url).host).toBe("localhost:5432");
    expect(new URL(url).search).toBe("?sslmode=disable");
  });

  it("returns the URL unchanged when no lane is set", () => {
    expect(laneDatabaseUrl(testUrl, undefined)).toBe(testUrl);
    expect(laneDatabaseUrl(testUrl, "  ")).toBe(testUrl);
  });

  it("does not stack a lane on a URL already on it", () => {
    const once = laneDatabaseUrl(testUrl, "d29");

    expect(laneDatabaseUrl(once, "d29")).toBe(once);
  });

  it("a lane database still has to end in _test", () => {
    // A lane cannot turn a development URL into one the guard passes.
    expect(() =>
      laneDatabaseUrl(
        "postgres://machxi_owner:machxi_owner@localhost:5432/machxi",
        "d29",
      ),
    ).toThrow(/must name a database ending in "_test"/);
    // And what it does produce passes the guard it sits on.
    expect(() =>
      assertTestDatabase(laneDatabaseUrl(testUrl, "d29")),
    ).not.toThrow();
  });

  it("refuses a lane that is not a branch slug", () => {
    for (const lane of ["lane/D29", "D29", "a_b", "-d29", "d29-", "x;drop"]) {
      expect(() => laneDatabaseUrl(testUrl, lane)).toThrow(/TEST_DB_LANE/);
    }
  });

  it("refuses a name longer than Postgres keeps", () => {
    expect(() => laneDatabaseUrl(testUrl, "a".repeat(52))).toThrow(
      /longer than the 63 bytes/,
    );
  });
});
