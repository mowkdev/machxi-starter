import { timingSafeEqual } from "node:crypto";

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

/** Constant-time equality over two UTF-8 strings of any length. */
const matches = (presented: string, expected: string): boolean => {
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");

  // `timingSafeEqual` throws on a length mismatch, which would itself be the
  // oracle: fold the length check into the result instead.
  return a.length === b.length && timingSafeEqual(a, b);
};

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
