import { randomBytes } from "node:crypto";

/** Fewest bytes {@link randomToken} will draw; below this a token is guessable. */
export const minTokenBytes = 16;

/** Most bytes {@link randomToken} will draw — `randomBytes` is synchronous. */
export const maxTokenBytes = 1024;

/**
 * Generates an opaque, cryptographically random token, base64url-encoded so it
 * is safe in a URL, a JSON body and a header without further escaping.
 *
 * Used for refresh tokens (ADR-0018: 32 random bytes, sent to the client once,
 * stored only as a SHA-256 hash). 32 bytes is 256 bits of entropy and encodes
 * to 43 characters with no padding.
 *
 * @param bytes number of random bytes to draw; defaults to 32.
 * @throws RangeError if `bytes` is not an integer in
 *   [{@link minTokenBytes}, {@link maxTokenBytes}].
 */
export const randomToken = (bytes = 32): string => {
  if (
    !Number.isInteger(bytes) ||
    bytes < minTokenBytes ||
    bytes > maxTokenBytes
  ) {
    throw new RangeError(
      `randomToken: bytes must be an integer in [${String(minTokenBytes)}, ` +
        `${String(maxTokenBytes)}], got ${String(bytes)}`,
    );
  }

  return randomBytes(bytes).toString("base64url");
};
