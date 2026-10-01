import { createHash, timingSafeEqual } from "node:crypto";

import type { Request } from "express";

/**
 * The metrics token, read and compared in one place (ADR-0066 §2).
 *
 * `/metrics` requires it whenever one is configured, and `/health` answers its
 * `commit` only to a request carrying it (ADR-0084 §3) — one credential, one
 * check, so the two can never disagree about what "carries the token" means.
 */

/**
 * The bearer token, or `undefined`.
 *
 * Deliberately only the `Bearer` scheme, and the comparison below is
 * constant-time: a token compared with `===` leaks its prefix to anyone who can
 * time the endpoint, which is the same argument ADR-0018 makes about session
 * tokens.
 */
const bearerToken = (req: Request): string | undefined => {
  const header = req.get("authorization");

  if (header === undefined) return undefined;

  const [scheme, ...rest] = header.split(" ");

  return scheme?.toLowerCase() === "bearer" && rest.length > 0
    ? rest.join(" ")
    : undefined;
};

/** SHA-256 of a UTF-8 string: 32 bytes whatever the input's length. */
const digest = (value: string): Buffer =>
  createHash("sha256").update(value, "utf8").digest();

/**
 * Equality over two UTF-8 strings, with timing independent of where they
 * differ and of whether their lengths do.
 *
 * `timingSafeEqual` throws on a length mismatch, and checking the lengths
 * first returns early, so the time taken would tell a caller whether it had
 * guessed the token's length. Both sides are hashed to a fixed width instead,
 * and the digests compared: there is no length check to time. Hashing costs
 * time in proportion to the presented string, which tells the caller only the
 * length it chose.
 */
const matches = (presented: string, expected: string): boolean =>
  timingSafeEqual(digest(presented), digest(expected));

/**
 * Whether `req` carries the configured metrics token.
 *
 * `false` when no token is configured: "carries the configured token" cannot
 * be true of a deployment that configured none, so a caller that wants the
 * unset case to mean "open" — `/metrics` outside production — says so itself.
 */
export const carriesMetricsToken = (
  req: Request,
  token: string | undefined,
): boolean => {
  if (token === undefined) return false;

  const presented = bearerToken(req);

  return presented !== undefined && matches(presented, token);
};
