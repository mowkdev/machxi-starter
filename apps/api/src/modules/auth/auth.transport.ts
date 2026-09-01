import type { AuthResource, Population } from "@repo/contracts";
import type { Request, Response } from "express";

import { readTransport, setAuthCookies } from "./auth.cookies.js";
import type { IssuedAuthResource } from "./auth.mapper.js";

/**
 * Where the refresh token travels, decided once (ADR-0029, ADR-0018 §Token
 * transport).
 *
 * This was a closure inside `createAuthController` until `D13.4`. It moved
 * because a second controller now issues a session — the impersonation
 * exchange (ADR-0057 §3), which must set "the user-population cookies
 * **exactly as login does**" — and two copies of this decision would drift on
 * an attribute nobody notices until a browser stops being able to refresh.
 *
 * It stays out of `auth.cookies.ts` on purpose: that file knows cookie names
 * and attributes, and this one knows the *rule* about which representation a
 * caller gets. Both are controller-layer concerns, and neither is the
 * service's — `createAuthService` returns an `AuthResource` and has never
 * known whether the token would leave in a body or a `Set-Cookie`.
 */

export interface AuthTransportOptions {
  /** The segment answering, which decides the cookie `Path` (ADR-0029). */
  readonly population: Population;
  /** `REFRESH_TOKEN_TTL` (ADR-0004) — the cookie's `Max-Age`. */
  readonly maxAgeSec: number;
  /**
   * Forces cookie transport because the request *arrived* on it.
   *
   * Only `refresh` passes this, and it closes a trap the header-only rule
   * leaves open: a browser that refreshes from its cookie but forgets the
   * header would be answered with the rotated token in the body and **no new
   * cookie**, leaving the browser holding the value that was just rotated
   * away. The next refresh replays it — inside the grace window that is
   * tolerated, outside it that is reuse detection, and the session is revoked
   * (ADR-0018 §Refresh). A missing header would cost the user their session,
   * which is too sharp an edge for an opt-in to have.
   *
   * It is not the `Origin`-sniffing ADR-0029 rejected: nothing is inferred
   * about the client, and the only signal used is the credential it actually
   * presented.
   */
  readonly cookieDriven?: boolean;
}

/**
 * Puts the refresh token where the caller asked for it.
 *
 * On `body` transport — the default — this is the identity function and no
 * cookie is set. On `cookie` transport the token goes into
 * `__Secure-machxi.refresh`, a fresh CSRF token goes beside it, and the field
 * is **removed from the body**: leaving it in both places would defeat the
 * point, since the value an XSS is being denied would still be sitting in the
 * response it can read.
 *
 * `refreshTokenExpiresAt` stays either way — knowing when the session ends is
 * useful to a client that cannot see the credential, and for an impersonated
 * session it is the only place the fixed end appears on the wire.
 */
export const applyAuthTransport = (
  req: Request,
  res: Response,
  resource: IssuedAuthResource,
  { population, maxAgeSec, cookieDriven = false }: AuthTransportOptions,
): AuthResource => {
  if (!cookieDriven && readTransport(req) === "body") return resource;

  const { refreshToken, ...rest } = resource;

  const csrfToken = setAuthCookies(req, res, {
    population,
    token: refreshToken,
    maxAgeSec,
  });

  // In the body as well as in the cookie, and the two are for different
  // moments: the cookie is what a page reads after a reload, and this is what
  // an app on a different host than the API uses, since it can never read the
  // API's cookies at all (ADR-0029 §CSRF, amended D2.5).
  return { ...rest, csrfToken };
};
