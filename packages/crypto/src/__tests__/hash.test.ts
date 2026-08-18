import { describe, expect, it } from "vitest";

import { randomToken, sha256Base64url } from "../index.js";

describe("sha256Base64url", () => {
  it("matches the published SHA-256 vector for 'abc'", () => {
    // NIST FIPS 180-4 vector ba7816bf…, base64url-encoded.
    expect(sha256Base64url("abc")).toBe(
      "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0",
    );
  });

  it("hashes the empty string", () => {
    expect(sha256Base64url("")).toBe(
      "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU",
    );
  });

  it("is deterministic — the same token always maps to the same row key", () => {
    const token = randomToken();

    expect(sha256Base64url(token)).toBe(sha256Base64url(token));
  });

  it("separates inputs that differ by one character", () => {
    expect(sha256Base64url("token-a")).not.toBe(sha256Base64url("token-b"));
  });

  it("emits 43 base64url characters with no padding or +/ ", () => {
    const digest = sha256Base64url(randomToken());

    // 32 bytes -> 43 chars unpadded; base64url swaps + / for - _ so the value
    // is safe in a URL and in a text column without escaping.
    expect(digest).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("treats the input as utf8 rather than latin1", () => {
    expect(sha256Base64url("é")).not.toBe(sha256Base64url("Ã©"));
  });
});
