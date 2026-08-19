import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

import {
  CSRF_COOKIE,
  CSRF_HEADER,
  REFRESH_COOKIE,
  readCookie,
} from "../http/cookies.js";
import { forbidden } from "../errors/index.js";

/**
 * Double-submit CSRF protection for the cookie-driven auth endpoints
 * (ADR-0029 §CSRF).
 *
 * `SameSite=Strict` already stops a cross-**site** request from carrying the
 * refresh cookie, and against a purely cross-site attacker it is sufficient.
 * It is not the whole threat: a compromised or attacker-controlled subdomain
 * is same-site, and `SameSite` is a browser behaviour rather than a check this
 * API performs. So a request that leans on the cookie must also echo a value
 * only a same-origin script could have read.
 *
 * No container dependency and no state: the token is compared against the
 * cookie it was issued alongside, so there is nothing to store and nothing to
 * expire independently of the session.
 */

/**
 * Whether the request is relying on the refresh **cookie**.
 *
 * A caller that put its refresh token in the body is not cookie-driven and is
 * not subject to the check — that is ADR-0029's rule, and it is what keeps
 * every mobile client, Postman and the `body`-transport half of the
 * integration suite untouched by any of this.
 *
 * `req.body` rather than `req.valid.body`: this guard runs before `validate`,
 * because a request that fails CSRF should not first have its body parsed for
 * error messages. The only question asked of the body is whether the caller
 * supplied a token at all.
 */
const isCookieDriven = (req: Request): boolean => {
  if (readCookie(req, REFRESH_COOKIE) === undefined) return false;

  const body: unknown = req.body;

  const suppliedInBody =
    typeof body === "object" &&
    body !== null &&
    "refreshToken" in body &&
    typeof (body as { refreshToken?: unknown }).refreshToken === "string" &&
    (body as { refreshToken: string }).refreshToken.length > 0;

  return !suppliedInBody;
};

/**
 * Constant-time string comparison.
 *
 * `timingSafeEqual` throws on a length mismatch, so the lengths are compared
 * first — which leaks the length and nothing else. Both values here are
 * fixed-width tokens, so in practice a mismatched length means "not one of
 * ours" rather than a partial guess.
 */
const equals = (a: string, b: string): boolean => {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");

  return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * Requires `X-CSRF-Token` to match the `machxi.csrf` cookie on a cookie-driven
 * request, and does nothing otherwise.
 *
 * `403` and not `401`: whoever sent this may well hold a valid session — the
 * point of the check is that we cannot tell whether *they* meant to send the
 * request. A `401` would tell a client whose token merely went stale to throw
 * the session away.
 */
export const csrfGuard = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  if (!isCookieDriven(req)) {
    next();

    return;
  }

  const cookie = readCookie(req, CSRF_COOKIE);
  const header = req.get(CSRF_HEADER);

  if (
    cookie === undefined ||
    header === undefined ||
    cookie.length === 0 ||
    !equals(cookie, header)
  ) {
    throw forbidden("CSRF token missing or invalid", "CSRF_TOKEN_INVALID");
  }

  next();
};
