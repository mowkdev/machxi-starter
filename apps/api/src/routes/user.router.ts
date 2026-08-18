import { Router } from "express";

import type { Container } from "../core/container.js";
import { createAuthRouter } from "../modules/auth/index.js";

/**
 * `/api/v1/user/*` (ADR-0015) — requires a user principal.
 *
 * `/auth` is mounted first and guards itself: `login` and `refresh` are how a
 * client obtains a token, so they cannot sit behind one, while `logout`,
 * `logout-all` and `me` are guarded inside the auth router.
 *
 * Step 9 adds the profile endpoints below a segment-wide guard:
 *
 * ```ts
 * router.use(authenticate("user"));
 * router.use("/profile", createUserProfileRouter(c));
 * ```
 *
 * The guard goes on the router, not on each route, so a new endpoint is
 * protected by where it is mounted rather than by remembering a decorator.
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
    }),
  );

  return router;
};
