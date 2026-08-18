import { describe, expect, it } from "vitest";

import { MAX_DURATION_SECONDS, parseDurationSeconds } from "../duration.js";

/**
 * ADR-0004: `JWT_ACCESS_TTL` and `REFRESH_TOKEN_TTL` are written as durations
 * and consumed as seconds. Whatever this rejects becomes a startup failure, so
 * the interesting cases are the ones that look valid enough to reach
 * production.
 */
describe("parseDurationSeconds", () => {
  it.each([
    ["30s", 30],
    ["15m", 900],
    ["12h", 43_200],
    ["30d", 2_592_000],
    ["1d", 86_400],
  ])("parses %s", (value, expected) => {
    expect(parseDurationSeconds(value)).toBe(expected);
  });

  it("tolerates surrounding whitespace, which a .env file readily produces", () => {
    expect(parseDurationSeconds("  15m ")).toBe(900);
  });

  it.each([
    ["", "empty"],
    ["15", "no unit — ambiguous between seconds and minutes"],
    ["m", "no amount"],
    ["15M", "case-sensitive: M would read as minutes or as months"],
    ["1w", "weeks are not accepted"],
    ["1mo", "months are ambiguous, which is why there is no unit for them"],
    ["15m30s", "compound durations would need a grammar, not a regex"],
    ["-5m", "negative"],
    ["1.5h", "fractional"],
    ["0s", "zero would issue a token that is already expired"],
    ["15 m", "an inner space is a typo, not a separator"],
  ])("rejects %j (%s)", (value) => {
    expect(parseDurationSeconds(value)).toBeNull();
  });

  it("rejects a duration past a year, where the extra digit is the likelier reading", () => {
    expect(parseDurationSeconds("365d")).toBe(MAX_DURATION_SECONDS);
    expect(parseDurationSeconds("366d")).toBeNull();
    expect(parseDurationSeconds("3000d")).toBeNull();
  });
});
