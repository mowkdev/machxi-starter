import { createHash } from "node:crypto";

/**
 * SHA-256 of `input`, base64url-encoded.
 *
 * This is the storage form of refresh tokens (ADR-0018): the `sessions` table
 * holds only the hash, so a database read cannot yield a usable token. A plain
 * unsalted digest is correct here — the input is 256 bits of entropy from
 * {@link randomToken}, not a low-entropy secret, so there is nothing for a
 * rainbow table to precompute and the lookup must stay a single indexed
 * equality match.
 *
 * Not for passwords. Use `createArgon2Hasher` for those.
 */
export const sha256Base64url = (input: string): string =>
  createHash("sha256").update(input, "utf8").digest("base64url");
