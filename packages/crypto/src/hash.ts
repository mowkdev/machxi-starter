import { createHash } from "node:crypto";

/**
 * SHA-256 of `input`, base64url-encoded.
 *
 * This is the storage form of refresh tokens (ADR-0018): the `sessions` table
 * holds only the hash, so a database read cannot yield a usable token. A plain
 * unsalted digest is correct **for that input**: it is 256 bits of CSPRNG
 * output from `randomToken`, so there is nothing for a rainbow table to
 * precompute, and the lookup must stay a single indexed equality match.
 *
 * That reasoning does not transfer. Never use this for a password or for any
 * other low-entropy secret — use `createArgon2Hasher` for those.
 */
export const sha256Base64url = (input: string): string =>
  createHash("sha256").update(input, "utf8").digest("base64url");
