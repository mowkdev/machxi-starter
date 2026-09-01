import type { Population } from "@repo/contracts";
import { Router, type RequestHandler } from "express";

import {
  createCsrfGuard,
  noStore,
  validate,
} from "../../core/middleware/index.js";
import type { AuthController } from "./auth.controller.js";
import type { ImpersonationController } from "./auth.impersonation.controller.js";
import { exchangeImpersonationSchema } from "./auth.impersonation.schemas.js";
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
  /**
   * The exchange half of the impersonation flow (ADR-0057 §3).
   *
   * Passed to both mounts and registered by only one — see the route below.
   * It is a dependency of the factory rather than of the segment router so
   * that the `population === "user"` condition lives beside the route it
   * guards, where a reader can see it.
   */
  readonly impersonation: Pick<ImpersonationController, "exchange">;
  /**
   * ADR-0057 §5's exclusion guard, mounted on `logout-all` (ADR-0019).
   *
   * Passed to both segments and refusing on neither unless the principal
   * carries an actor, which only a customer's can: the staff mount is a no-op
   * by construction rather than by a condition someone has to maintain.
   */
  readonly refuseImpersonated: RequestHandler;
}

export const createAuthRouter = ({
  controller,
  authenticate,
  population,
  loginRateLimiter,
  refreshRateLimiter,
  impersonation,
  refuseImpersonated,
}: AuthRouterDeps): Router => {
  const router = Router();

  // Every response here either carries a credential or describes who holds
  // one. A cached `/auth/me` or a token response kept by a shared proxy is a
  // session leak, and `no-store` is the only directive that also forbids
  // writing it to disk (ADR-0020).
  router.use(noStore);

  // Unauthenticated by definition: these are how a client *gets* a token.
  //
  // `/csrf` is first because it is what a reloaded browser calls before it can
  // call anything else (ADR-0030). It carries no limiter of its own: the
  // global one (ADR-0020) covers it, and it deliberately does **not** take
  // `refreshRateLimiter` — that budget is for guessing at opaque tokens, and a
  // bootstrap presents nothing to guess. Charging it there would let any page
  // spend a visitor's refresh budget by calling this endpoint.
  router.get("/csrf", controller.csrf);
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
    // The one endpoint where a token in the body is a legitimate way to
    // present the credential, and therefore the only one where it exempts the
    // request from the check (ADR-0029 §CSRF).
    createCsrfGuard({ population, allowBodyToken: true }),
    validate(refreshSchema),
    controller.refresh,
  );

  // The exchange (ADR-0057 §3), unauthenticated like `login` and for the same
  // reason: the handoff token is the credential, and a client that had a
  // session would not need one.
  //
  // **Only on the `user` segment.** This factory is mounted once per segment,
  // so an unconditional registration would create an admin-segment twin — a
  // way to turn a URL fragment into a staff session, which is exactly what the
  // whole handoff design refuses to allow. The condition is the guard.
  //
  // No CSRF guard, for the reason `login` carries none: the request leans on
  // no cookie at all — nothing in the browser's jar authorises it — so there
  // is no cross-site submission to prove intent for. It carries no limiter of
  // its own either: the mint is where a budget belongs (ADR-0057 §1), the
  // token here is 32 random bytes with a 60-second life, and the global
  // limiter covers the endpoint.
  if (population === "user") {
    router.post(
      "/impersonate",
      validate(exchangeImpersonationSchema),
      impersonation.exchange,
    );
  }

  // Everything registered below this line requires a principal of this
  // population. Mounting the guard once, here, is what makes a future endpoint
  // protected by where it sits rather than by somebody remembering to add a
  // decorator (ADR-0019 §1).
  router.use(authenticate(population));

  // Both carry the guard for the same reason `refresh` does: a browser on
  // cookie transport sends the refresh cookie here too — the path matches —
  // and ending somebody's session from another site is a smaller prize than
  // stealing it but still not one to hand over.
  //
  // `population` reaches the guard the same way it reaches `authenticate`
  // above: this factory is mounted once per segment, so the segment is what
  // decides which CSRF cookie is checked (ADR-0056).
  router.post("/logout", createCsrfGuard({ population }), controller.logout);
  // `logout-all` is on ADR-0057 §5's exclusion list and `logout` deliberately
  // is not: one ends the **customer's** real sessions on every device they own,
  // which is a takeover step and not support work, and the other is the
  // impersonation banner's own exit control. The guard sits after the CSRF
  // check and before the controller, so a refusal costs one comparison and
  // reaches no service.
  router.post(
    "/logout-all",
    createCsrfGuard({ population }),
    refuseImpersonated,
    controller.logoutAll,
  );
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
