import { Router } from "express";

import type { Container } from "../core/container.js";
import { createAuthRouter } from "../modules/auth/index.js";
import { createSettingsRouter } from "../modules/settings/index.js";
import { createUserProfileRouter } from "../modules/users/index.js";

/**
 * `/api/v1/user/*` (ADR-0015) — requires a user principal.
 *
 * `/auth` is mounted first and guards itself: `login`, `refresh` and — since
 * `D13.4` — `impersonate` are how a client obtains a token, so they cannot sit
 * behind one, while `logout`, `logout-all` and `me` are guarded inside the
 * auth router.
 *
 * Everything registered *after* `authenticate("user")` requires one. The guard
 * goes on the router, not on each route, so a new endpoint is protected by
 * where it is mounted rather than by somebody remembering a decorator
 * (ADR-0019 §1).
 *
 * There is no `authorize` in this segment and that is not an omission:
 * `customer` is the only user role in v1, so authentication already implies
 * it, and the profile endpoints address `ctx.principal` rather than an `:id`
 * — the ownership question ADR-0019 §3 asks has no way to be answered wrongly
 * when there is no id to compare. `/settings` joins on the same footing
 * (ADR-0045): same subject, same absence of an id, same table selected by the
 * population rather than by anything a request carries.
 */
export const createUserRouter = (container: Container): Router => {
  const router = Router();

  router.use(
    "/auth",
    createAuthRouter({
      controller: container.controllers.userAuth,
      authenticate: container.authenticate,
      population: "user",
      loginRateLimiter: container.rateLimiters.login,
      refreshRateLimiter: container.rateLimiters.refresh,
      // `POST /user/auth/impersonate` (ADR-0057 §3) — registered here and
      // nowhere else, because the auth router is one factory per segment and
      // an admin-segment twin would turn a URL fragment into a staff session.
      impersonation: container.controllers.impersonation,
      // ADR-0057 §5: `logout-all` ends the customer's real sessions everywhere
      // and an impersonator may not.
      refuseImpersonated: container.refuseImpersonated,
    }),
  );

  router.use(container.authenticate("user"));

  router.use(
    "/profile",
    createUserProfileRouter({
      controller: container.controllers.userProfile,
      refuseImpersonated: container.refuseImpersonated,
    }),
  );

  router.use(
    "/settings",
    createSettingsRouter({
      controller: container.controllers.settings,
      population: "user",
    }),
  );

  return router;
};
