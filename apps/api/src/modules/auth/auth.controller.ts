import type { AuthResource, CsrfResource, Population } from "@repo/contracts";
import type { Request, Response } from "express";

import { validation } from "../../core/errors/index.js";
import { respond } from "../../core/http/index.js";
import type { ValidatedRequest } from "../../core/middleware/index.js";
import {
  clearAuthCookies,
  readRefreshCookie,
  ensureCsrfCookie,
} from "./auth.cookies.js";
import type { IssuedAuthResource } from "./auth.mapper.js";
import type { AuthService } from "./auth.service.js";
import { applyAuthTransport } from "./auth.transport.js";
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
   * Puts the refresh token where the caller asked for it, on this segment's
   * cookies and this population's TTL.
   *
   * The rule itself lives in `auth.transport.ts` since `D13.4`: the
   * impersonation exchange places the same cookies from its own controller
   * (ADR-0057 §3 — "exactly as login does"), and one copy is what keeps the
   * two from drifting apart on an attribute nobody would notice until a
   * browser stopped being able to refresh.
   */
  const applyTransport = (
    req: Request,
    res: Response,
    resource: IssuedAuthResource,
    cookieDriven = false,
  ): AuthResource =>
    applyAuthTransport(req, res, resource, {
      population,
      maxAgeSec: refreshTtlSec,
      cookieDriven,
    });

  return {
    /**
     * `GET /auth/csrf` — the bootstrap (ADR-0030).
     *
     * The one endpoint in the flow that cannot require a CSRF token, because
     * it is where a client gets one. It takes no input, reads no credential
     * and touches no database: a `randomToken(32)`, a `Set-Cookie` and the
     * same value in the body, which is the only copy an app on a different
     * host than the API will ever be able to see.
     *
     * Unauthenticated by necessity as much as by principle — it runs at the
     * moment a reloaded page holds no access token, so a guarded version
     * would be an endpoint nothing could call. That reachability is also why
     * it echoes an existing token rather than rotating: see
     * {@link ensureCsrfCookie}.
     */
    csrf: (req: Request, res: Response): void => {
      respond.ok<CsrfResource>(res, {
        csrfToken: ensureCsrfCookie(req, res, population, refreshTtlSec),
      });
    },

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
      clearAuthCookies(req, res, population);
      respond.noContent(res);
    },

    logoutAll: async (req: Request, res: Response): Promise<void> => {
      await service.logoutAll(req.ctx);
      clearAuthCookies(req, res, population);
      respond.noContent(res);
    },

    me: async (req: Request, res: Response): Promise<void> => {
      respond.ok(res, await service.me(req.ctx));
    },
  } as const;
};

export type AuthController = ReturnType<typeof createAuthController>;
