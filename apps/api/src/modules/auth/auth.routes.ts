import type { Population } from "@repo/contracts";
import { Router, type RequestHandler } from "express";

import { csrfGuard, noStore, validate } from "../../core/middleware/index.js";
import type { AuthController } from "./auth.controller.js";
import { loginSchema, refreshSchema, registerSchema } from "./auth.schemas.js";

/**
 * `/api/v1/{admin,user}/auth/*` and `/api/v1/public/auth/register`
 * (ADR-0015, ADR-0018).
 *
 * One router factory serves both populations: the segment decides which
 * service is behind it and which population `authenticate` pins the token to,
 * and nothing about the URLs or the order below differs between them.
 *
 * The per-route order is the one ADR-0011 fixes:
 * `rateLimit → authenticate → authorize → validate → controller`. There is no
 * `authorize` here — being authenticated *is* the requirement for reading your
 * own principal or ending your own session.
 */

export interface AuthRouterDeps {
  readonly controller: AuthController;
  /** `authenticate(population)` from the container (ADR-0011). */
  readonly authenticate: (population: Population) => RequestHandler;
  readonly population: Population;
  readonly loginRateLimiter: RequestHandler;
  readonly refreshRateLimiter: RequestHandler;
}

export const createAuthRouter = ({
  controller,
  authenticate,
  population,
  loginRateLimiter,
  refreshRateLimiter,
}: AuthRouterDeps): Router => {
  const router = Router();

  // Every response here either carries a credential or describes who holds
  // one. A cached `/auth/me` or a token response kept by a shared proxy is a
  // session leak, and `no-store` is the only directive that also forbids
  // writing it to disk (ADR-0020).
  router.use(noStore);

  // Unauthenticated by definition: these are how a client *gets* a token.
  router.post(
    "/login",
    loginRateLimiter,
    validate(loginSchema),
    controller.login,
  );
  // `csrfGuard` before `validate`, and that is the ADR-0011 order rather than
  // an exception to it: it is a guard, and a request that fails it should not
  // first have its body parsed to produce a better error message. It does
  // nothing at all unless the request is leaning on the refresh cookie
  // (ADR-0029 §CSRF), so every `body`-transport caller passes straight through.
  router.post(
    "/refresh",
    refreshRateLimiter,
    csrfGuard,
    validate(refreshSchema),
    controller.refresh,
  );

  // Everything registered below this line requires a principal of this
  // population. Mounting the guard once, here, is what makes a future endpoint
  // protected by where it sits rather than by somebody remembering to add a
  // decorator (ADR-0019 §1).
  router.use(authenticate(population));

  // Both carry the guard for the same reason `refresh` does: a browser on
  // cookie transport sends the refresh cookie here too — the path matches —
  // and ending somebody's session from another site is a smaller prize than
  // stealing it but still not one to hand over.
  router.post("/logout", csrfGuard, controller.logout);
  router.post("/logout-all", csrfGuard, controller.logoutAll);
  router.get("/me", controller.me);

  return router;
};

export interface RegisterRouterDeps {
  readonly controller: AuthController;
  /** The login limiter: registration hashes a password and creates a session too. */
  readonly rateLimiter: RequestHandler;
}

/**
 * `POST /api/v1/public/auth/register` (ADR-0018 §Staff onboarding).
 *
 * A separate router because it belongs to a different segment: it is the one
 * auth endpoint that is genuinely public, and it exists only for `users` —
 * staff are created by an admin. The container mounts it only when
 * `FEATURE_USER_REGISTRATION` is on (ADR-0004), so with the flag off the path
 * answers `ROUTE_NOT_FOUND` rather than a `403` that would confirm the feature
 * exists.
 */
export const createRegisterRouter = ({
  controller,
  rateLimiter,
}: RegisterRouterDeps): Router => {
  const router = Router();

  router.use(noStore);
  router.post(
    "/register",
    rateLimiter,
    validate(registerSchema),
    controller.register,
  );

  return router;
};
