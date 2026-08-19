import type { Population } from "@repo/contracts";
import { randomToken } from "@repo/crypto";
import type { Request, Response } from "express";

import {
  CSRF_COOKIE,
  CSRF_COOKIE_PATH,
  REFRESH_COOKIE,
  TRANSPORT_HEADER,
  authCookiePath,
  readCookie,
} from "../../core/http/index.js";

/**
 * The browser half of ADR-0018 §Token transport, decided by ADR-0029.
 *
 * Everything here is about *where a token travels*, which is a controller
 * concern by construction: `createAuthService` returns an `AuthResource` and
 * has never known whether the refresh token would leave in a body or a
 * `Set-Cookie`. This file is what keeps that true — the service is untouched
 * by cookie transport, and rotation, the grace window and reuse detection go
 * on operating on the token's value without caring how it arrived.
 */

/**
 * How a client asks for cookie transport, and what it gets if it does not ask.
 *
 * The default is `body`, which is D1's behaviour, so this ADR breaks no
 * existing caller on the day it lands. Inferring "this is a browser" from
 * `Origin` or `User-Agent` was rejected: both are client-controlled, both
 * appear on non-browser requests, and guessing wrong puts a thirty-day
 * credential in a response the client did not expect and therefore does not
 * protect.
 */
export type AuthTransport = "body" | "cookie";

export const readTransport = (req: Request): AuthTransport =>
  req.get(TRANSPORT_HEADER)?.trim().toLowerCase() === "cookie"
    ? "cookie"
    : "body";

/**
 * Attributes shared by both cookies.
 *
 * `secure` is unconditional and there is no flag to turn it off. Browsers
 * treat `http://localhost` as a trustworthy origin and accept `Secure` cookies
 * from it, so local development works; developing against a LAN IP over plain
 * HTTP will not, and that is the intended answer — a flag that disables
 * `Secure` is a flag that eventually ships enabled.
 *
 * `sameSite: "strict"` rather than `lax`: `lax` exists so that top-level
 * navigations carry a session cookie, and nothing here is a navigation —
 * `/auth/refresh` is only ever reached by `fetch`.
 */
const baseAttributes = (population: Population) =>
  ({
    secure: true,
    sameSite: "strict",
    path: authCookiePath(population),
  }) as const;

/**
 * The CSRF cookie's attributes, in one place because three call sites write
 * them and `res.clearCookie` only deletes a cookie whose `path`, `secure` and
 * `sameSite` match what was set — a drift here is a logout that leaves a live
 * cookie behind.
 *
 * Deliberately not {@link baseAttributes}: the `Path` differs on purpose.
 * `Path=/` rather than the segment path the refresh cookie uses, because a
 * cookie is only visible to `document.cookie` at the document's own path — an
 * app served from `/` cannot read one scoped to `/api/v1/admin/auth`. The
 * `__Host-` prefix requires `Path=/` too, and buys host-only in exchange.
 *
 * Not `httpOnly`, which is the mechanism rather than an oversight: the client
 * reads this one and echoes it in `X-CSRF-Token`.
 */
const csrfAttributes = {
  secure: true,
  sameSite: "strict",
  path: CSRF_COOKIE_PATH,
  httpOnly: false,
} as const;

const writeCsrfCookie = (
  res: Response,
  csrfToken: string,
  maxAgeSec: number,
): string => {
  res.cookie(CSRF_COOKIE, csrfToken, {
    ...csrfAttributes,
    maxAge: maxAgeSec * 1000,
  });

  return csrfToken;
};

/**
 * Issues a **new** CSRF token, replacing whatever the client held.
 *
 * The rotating half, used by {@link setAuthCookies}: every response that sets
 * or rotates the refresh cookie issues a fresh token beside it, so a leaked one
 * is worth one rotation.
 *
 * `maxAgeSec` is a parameter rather than a constant because it is the refresh
 * token's TTL (ADR-0004), which is configuration the module receives. Omitting
 * it would make a caller issue a session cookie where another issues a durable
 * one, and ADR-0029 §CSRF never stated this attribute — ADR-0030 does, amended
 * D3.2.
 */
export const setCsrfCookie = (res: Response, maxAgeSec: number): string =>
  writeCsrfCookie(res, randomToken(32), maxAgeSec);

/**
 * Returns the caller's current CSRF token, minting one only if it has none.
 *
 * The idempotent half, and the one ADR-0030's `GET /auth/csrf` uses. The
 * endpoint is unauthenticated and takes no input, which makes it reachable
 * from a cross-site **top-level navigation** — and a bootstrap that rotated
 * unconditionally would let any page invalidate a signed-in victim's token,
 * turning their next refresh into `403 CSRF_TOKEN_INVALID`. Echoing removes
 * that: a call the victim did not intend writes back the value they already
 * had. Rotation still happens on every login and every refresh, which is where
 * it is worth having.
 *
 * Echoing discloses nothing. The cookie is already readable by any page on
 * this host — that is what `httpOnly: false` is for — and the response body is
 * opaque to any origin outside the CORS allow-list, so a caller who cannot
 * already read the cookie cannot read the answer either.
 *
 * A duplicate or shadowed cookie reads as absent (`readCookie` fails closed,
 * ADR-0029) and therefore mints, which is the right way round: the client ends
 * up with one unambiguous value it can actually echo.
 */
export const ensureCsrfCookie = (
  req: Request,
  res: Response,
  maxAgeSec: number,
): string =>
  writeCsrfCookie(
    res,
    readCookie(req, CSRF_COOKIE) ?? randomToken(32),
    maxAgeSec,
  );

export interface RefreshCookieInput {
  readonly population: Population;
  readonly token: string;
  /** `REFRESH_TOKEN_TTL` (ADR-0004), matching the session's own expiry. */
  readonly maxAgeSec: number;
}

/**
 * Sets the refresh cookie and a fresh CSRF token beside it.
 *
 * The two always move together: every response that sets or rotates the
 * refresh cookie issues a new `machxi.csrf`, so a stolen CSRF token is worth
 * one rotation, and a client that has the cookie always has a matching header
 * value to send.
 *
 * @returns the CSRF token, for the caller that wants to log or assert on it.
 */
export const setAuthCookies = (
  res: Response,
  { population, token, maxAgeSec }: RefreshCookieInput,
): string => {
  res.cookie(REFRESH_COOKIE, token, {
    ...baseAttributes(population),
    httpOnly: true,
    maxAge: maxAgeSec * 1000,
  });

  return setCsrfCookie(res, maxAgeSec);
};

/**
 * Clears both cookies, with the attributes they were set with.
 *
 * `logout` and `logout-all` do this unconditionally, including for a
 * `body`-transport caller who has no cookies to clear — clearing nothing is
 * free, and the alternative is a browser that keeps sending a value the server
 * has already revoked, spending a `RATE_LIMIT_REFRESH_MAX` failure on every
 * attempt until the cookie expires on its own.
 */
export const clearAuthCookies = (
  res: Response,
  population: Population,
): void => {
  res.clearCookie(REFRESH_COOKIE, {
    ...baseAttributes(population),
    httpOnly: true,
  });
  res.clearCookie(CSRF_COOKIE, csrfAttributes);
};

/** The refresh token the browser attached, if it is on cookie transport. */
export const readRefreshCookie = (req: Request): string | undefined =>
  readCookie(req, REFRESH_COOKIE);
