import { Router } from "express";

import type { Container } from "../core/container.js";
import { createAuthRouter } from "../modules/auth/index.js";

/**
 * `/api/v1/admin/*` (ADR-0015) — requires a staff principal.
 *
 * `/auth` is mounted first because `login` and `refresh` are how staff obtain
 * a token; everything inside it that needs one guards itself.
 *
 * Step 9 adds the resource routers, each with its own role guard at the mount
 * point (ADR-0019 §Rules — a router without one is a review failure):
 *
 * ```ts
 * router.use(authenticate("staff"));
 * router.use("/staff", authorize("admin"), createStaffRouter(c));
 * router.use("/users", authorize("admin", "manager"), createUsersRouter(c));
 * ```
 */
export const createAdminRouter = (container: Container): Router => {
  const router = Router();

  router.use(
    "/auth",
    createAuthRouter({
      controller: container.controllers.staffAuth,
      authenticate: container.authenticate,
      population: "staff",
      loginRateLimiter: container.rateLimiters.login,
      refreshRateLimiter: container.rateLimiters.refresh,
    }),
  );

  return router;
};
