import type { AuthResource, Population } from "@repo/contracts";
import type { Request, Response } from "express";

import { validation } from "../../core/errors/index.js";
import { respond } from "../../core/http/index.js";
import type { ValidatedRequest } from "../../core/middleware/index.js";
import {
  clearAuthCookies,
  readRefreshCookie,
  readTransport,
  setAuthCookies,
} from "./auth.cookies.js";
import type { IssuedAuthResource } from "./auth.mapper.js";
import type { AuthService } from "./auth.service.js";
import type {
  loginSchema,
  refreshSchema,
  registerSchema,
} from "./auth.schemas.js";

/**
 * HTTP adapters for the auth endpoints (ADR-0009).
 *
 * These were one-liners until ADR-0029, and the thing that grew is exactly the
 * thing ADR-0018 said would: "the auth service returns tokens; the controller
 * decides body vs cookie". The service is unchanged by cookie transport — it
 * still returns an `AuthResource` and still knows nothing about HTTP — and
 * every decision about *where the refresh token travels* is in this file.
 *
 * The `ValidatedRequest<typeof …Schema>` parameter types are the only thing
 * keeping `req.valid` honest (ADR-0011, amended): the base `Request` types it
 * as `any`, so a controller that does not declare its schema reads an untyped
 * value that compiles and means nothing.
 */

export interface AuthControllerDeps {
  readonly service: AuthService;
  /**
   * Which segment this controller answers on. It decides the cookie `Path`,
   * so that a browser signed into both populations never sends one
   * population's refresh token to the other's endpoints (ADR-0029).
   */
  readonly population: Population;
  /** `REFRESH_TOKEN_TTL` (ADR-0004) — the cookie's `Max-Age`. */
  readonly refreshTtlSec: number;
}

export const createAuthController = ({
  service,
  population,
  refreshTtlSec,
}: AuthControllerDeps) => {
  /**
   * Puts the refresh token where the caller asked for it.
   *
   * On `body` transport — the default — this is the identity function and no
   * cookie is set. On `cookie` transport the token goes into
   * `__Secure-machxi.refresh`, a fresh CSRF token goes beside it, and the
   * field is **removed from the body**: leaving it in both places would defeat
   * the point, since the value an XSS is being denied would still be sitting
   * in the response it can read.
   *
   * `refreshTokenExpiresAt` stays either way — knowing when the session ends
   * is useful to a client that cannot see the credential.
   */
  const applyTransport = (
    req: Request,
    res: Response,
    resource: IssuedAuthResource,
    /**
     * Forces cookie transport because the request *arrived* on it.
     *
     * Only `refresh` passes this, and it closes a trap the header-only rule
     * leaves open: a browser that refreshes from its cookie but forgets the
     * header would be answered with the rotated token in the body and **no new
     * cookie**, leaving the browser holding the value that was just rotated
     * away. The next refresh replays it — inside the grace window that is
     * tolerated, outside it that is reuse detection, and the session is
     * revoked (ADR-0018 §Refresh). A missing header would cost the user their
     * session, which is too sharp an edge for an opt-in to have.
     *
     * It is not the `Origin`-sniffing ADR-0029 rejected: nothing is inferred
     * about the client, and the only signal used is the credential it actually
     * presented.
     */
    cookieDriven = false,
  ): AuthResource => {
    if (!cookieDriven && readTransport(req) === "body") return resource;

    const { refreshToken, ...rest } = resource;

    const csrfToken = setAuthCookies(res, {
      population,
      token: refreshToken,
      maxAgeSec: refreshTtlSec,
    });

    // In the body as well as in the cookie, and the two are for different
    // moments: the cookie is what a page reads after a reload, and this is
    // what an app on a different host than the API uses, since it can never
    // read the API's cookies at all (ADR-0029 §CSRF, amended D2.5).
    return { ...rest, csrfToken };
  };

  return {
    login: async (
      req: ValidatedRequest<typeof loginSchema>,
      res: Response,
    ): Promise<void> => {
      const resource = await service.login(req.ctx, req.valid.body);

      respond.ok(res, applyTransport(req, res, resource));
    },

    /**
     * The one endpoint that reads a credential from two possible places.
     *
     * The body wins when it is present, so a client that sends a token
     * explicitly gets what it asked for even if a stale cookie is still
     * attached; the cookie is the fallback, which is what a browser on cookie
     * transport relies on. Neither is a validation error rather than a `401`:
     * nothing was presented, so nothing was rejected.
     */
    refresh: async (
      req: ValidatedRequest<typeof refreshSchema>,
      res: Response,
    ): Promise<void> => {
      const fromCookie = readRefreshCookie(req);
      const refreshToken = req.valid.body.refreshToken ?? fromCookie;
      const cookieDriven =
        req.valid.body.refreshToken === undefined && fromCookie !== undefined;

      if (refreshToken === undefined) {
        throw validation("A refresh token is required", [
          {
            path: "refreshToken",
            message:
              "Send it in the body, or on the refresh cookie with X-Auth-Transport: cookie",
            code: "required",
          },
        ]);
      }

      const resource = await service.refresh(req.ctx, { refreshToken });

      respond.ok(res, applyTransport(req, res, resource, cookieDriven));
    },

    /** `201`: registration creates an account and signs it in (ADR-0018). */
    register: async (
      req: ValidatedRequest<typeof registerSchema>,
      res: Response,
    ): Promise<void> => {
      const resource = await service.register(req.ctx, req.valid.body);

      respond.created(res, applyTransport(req, res, resource));
    },

    /**
     * `204`: the session is gone, and there is nothing to say about it.
     *
     * The cookies are cleared unconditionally, including for a caller that
     * never had any. Clearing nothing is free; leaving a revoked token in the
     * browser costs a `RATE_LIMIT_REFRESH_MAX` failure on every retry until it
     * expires on its own.
     */
    logout: async (req: Request, res: Response): Promise<void> => {
      await service.logout(req.ctx);
      clearAuthCookies(res, population);
      respond.noContent(res);
    },

    logoutAll: async (req: Request, res: Response): Promise<void> => {
      await service.logoutAll(req.ctx);
      clearAuthCookies(res, population);
      respond.noContent(res);
    },

    me: async (req: Request, res: Response): Promise<void> => {
      respond.ok(res, await service.me(req.ctx));
    },
  } as const;
};

export type AuthController = ReturnType<typeof createAuthController>;
