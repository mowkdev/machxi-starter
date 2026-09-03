import { timingSafeEqual } from "node:crypto";
import type { Population } from "@repo/contracts";
import type { NextFunction, Request, Response } from "express";

import { CSRF_HEADER, readCookie, type CookieNames } from "../http/cookies.js";
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
const carriesBodyToken = (req: Request): boolean => {
  const body: unknown = req.body;

  return (
    typeof body === "object" &&
    body !== null &&
    "refreshToken" in body &&
    typeof (body as { refreshToken?: unknown }).refreshToken === "string" &&
    (body as { refreshToken: string }).refreshToken.length > 0
  );
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

export interface CsrfGuardOptions {
  /**
   * This deployment's cookie names, built once in the container from `APP_ID`
   * (ADR-0064 §1).
   *
   * Handed in rather than derived here, which is the argument the population
   * below makes as well: a guard that built its own names from a second copy
   * of the identifier could disagree with the controller that wrote the
   * cookies, and the disagreement would look like a client sending the wrong
   * token. One object, written and read by both.
   */
  readonly cookies: CookieNames;
  /**
   * Which population's cookie this guard checks (ADR-0056).
   *
   * The CSRF cookie is one per population, so the guard has to be told which
   * one it is standing in front of — and it is told the same way every other
   * guard learns it (ADR-0015's segments, ADR-0019): the router factory knows
   * its own segment and passes it down. There is no default. A guard that
   * guessed would validate the admin's token on the user's endpoints the day
   * somebody mounted it without thinking, which is exactly the sharing this
   * ADR exists to end.
   */
  readonly population: Population;
  /**
   * Whether a refresh token in the body exempts the request.
   *
   * True for `refresh`, which is the only endpoint where a body token is a
   * legitimate way to present the credential — that request is not
   * cookie-driven and ADR-0029 does not subject it to the check.
   *
   * False everywhere else, and `logout` / `logout-all` are why it is an option
   * rather than a constant: they take no body at all, so a `refreshToken`
   * field in one means nothing except that somebody wanted the exemption. It
   * is not reachable cross-site today — both require `Authorization: Bearer`,
   * which a cross-site page cannot set — but an exemption that exists for one
   * endpoint should not be honoured by endpoints that cannot use it.
   */
  readonly allowBodyToken?: boolean;
}

/**
 * Requires `X-CSRF-Token` to match this population's `<app>.csrf.*` cookie on
 * a cookie-driven request, and does nothing otherwise.
 *
 * `403` and not `401`: whoever sent this may well hold a valid session — the
 * point of the check is that we cannot tell whether *they* meant to send the
 * request. A `401` would tell a client whose token merely went stale to throw
 * the session away.
 */
export const createCsrfGuard =
  ({ cookies, population, allowBodyToken = false }: CsrfGuardOptions) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const cookieDriven =
      readCookie(req, cookies.refresh) !== undefined &&
      !(allowBodyToken && carriesBodyToken(req));

    if (!cookieDriven) {
      next();

      return;
    }

    /*
     * This population's cookie and no other. A browser signed into both apps
     * sends both names here — they are at `Path=/` — and reading the wrong one
     * would refuse a request the client got exactly right (ADR-0056).
     */
    const cookie = readCookie(req, cookies.csrf(population));
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
