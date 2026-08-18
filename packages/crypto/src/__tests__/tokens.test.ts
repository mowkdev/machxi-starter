import { describe, expect, it } from "vitest";

import { maxTokenBytes, minTokenBytes, randomToken } from "../index.js";

describe("randomToken", () => {
  it("defaults to 32 bytes — 256 bits, 43 base64url characters (ADR-0018)", () => {
    const token = randomToken();

    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("honours an explicit byte length", () => {
    // base64url of n bytes is ceil(n/3)*4 minus padding: 16 -> 22, 64 -> 86.
    expect(randomToken(16)).toHaveLength(22);
    expect(randomToken(64)).toHaveLength(86);
  });

  it("never emits padding or non-url-safe characters", () => {
    for (let bytes = minTokenBytes; bytes <= 48; bytes += 1) {
      expect(randomToken(bytes)).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("does not repeat across many draws", () => {
    const draws = Array.from({ length: 500 }, () => randomToken());

    expect(new Set(draws).size).toBe(draws.length);
  });

  it("rejects byte counts that would make the token guessable", () => {
    expect(() => randomToken(minTokenBytes - 1)).toThrow(RangeError);
    expect(() => randomToken(1)).toThrow(RangeError);
    expect(() => randomToken(0)).toThrow(RangeError);
    expect(() => randomToken(-1)).toThrow(RangeError);
  });

  it("rejects byte counts that would block the event loop", () => {
    // randomBytes is synchronous, so an unbounded argument is a DoS vector.
    expect(() => randomToken(maxTokenBytes + 1)).toThrow(RangeError);
    expect(() => randomToken(1e9)).toThrow(RangeError);
  });

  it("rejects non-integers", () => {
    expect(() => randomToken(32.5)).toThrow(RangeError);
    expect(() => randomToken(Number.NaN)).toThrow(RangeError);
    expect(() => randomToken(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it("accepts both ends of the permitted range", () => {
    expect(() => randomToken(minTokenBytes)).not.toThrow();
    expect(() => randomToken(maxTokenBytes)).not.toThrow();
  });
});
