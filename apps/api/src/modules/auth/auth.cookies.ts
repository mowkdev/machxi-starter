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
  const csrfToken = randomToken(32);
  const maxAge = maxAgeSec * 1000;

  res.cookie(REFRESH_COOKIE, token, {
    ...baseAttributes(population),
    httpOnly: true,
    maxAge,
  });

  // Not `httpOnly`, and that is the mechanism rather than an oversight: the
  // client reads this one and echoes it in `X-CSRF-Token`.
  //
  // `Path=/` rather than the segment path its sibling uses, because a cookie
  // is only visible to `document.cookie` at the document's own path — an app
  // served from `/` cannot read one scoped to `/api/v1/admin/auth`. The
  // `__Host-` prefix requires `Path=/` too, and buys host-only in exchange.
  res.cookie(CSRF_COOKIE, csrfToken, {
    secure: true,
    sameSite: "strict",
    path: CSRF_COOKIE_PATH,
    httpOnly: false,
    maxAge,
  });

  return csrfToken;
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
  res.clearCookie(CSRF_COOKIE, {
    secure: true,
    sameSite: "strict",
    path: CSRF_COOKIE_PATH,
    httpOnly: false,
  });
};

/** The refresh token the browser attached, if it is on cookie transport. */
export const readRefreshCookie = (req: Request): string | undefined =>
  readCookie(req, REFRESH_COOKIE);
