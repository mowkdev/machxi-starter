import { randomBytes } from "node:crypto";

/**
 * Generates an opaque, cryptographically random token, base64url-encoded so it
 * is safe in a URL, a JSON body and a header without further escaping.
 *
 * Used for refresh tokens (ADR-0018: 32 random bytes, sent to the client once,
 * stored only as a SHA-256 hash). 32 bytes is 256 bits of entropy and encodes
 * to 43 characters with no padding.
 *
 * @param bytes number of random bytes to draw; defaults to 32.
 */
export const randomToken = (bytes = 32): string => {
  if (!Number.isInteger(bytes) || bytes < 1) {
    throw new RangeError(`randomToken: bytes must be a positive integer, got ${String(bytes)}`);
  }

  return randomBytes(bytes).toString("base64url");
};
