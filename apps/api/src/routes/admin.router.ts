import { Router } from "express";

import type { Container } from "../core/container.js";
import { authorize } from "../core/middleware/index.js";
import { createAuthRouter } from "../modules/auth/index.js";
import { createStaffRouter } from "../modules/staff/index.js";
import { createUsersRouter } from "../modules/users/index.js";

/**
 * `/api/v1/admin/*` (ADR-0015) — requires a staff principal.
 *
 * `/auth` is mounted first because `login` and `refresh` are how staff obtain
 * a token; everything inside it that needs one guards itself. Everything
 * registered *after* `authenticate("staff")` is protected by where it sits
 * rather than by somebody remembering a decorator (ADR-0019 §1).
 *
 * Each resource declares its role guard here, at the mount point — a resource
 * router without one is a review failure (ADR-0019 §Rules), and putting them
 * side by side is what makes "who may touch what" readable in one place:
 *
 * - `/staff` is `admin` throughout. Managing operators is not a manager's job.
 * - `/users` is `admin` **or** `manager` to read, and the router narrows its
 *   three writing routes back to `admin`.
 *
 * `super_admin` bypasses both, on the single line in `authorize` that says so.
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

  router.use(container.authenticate("staff"));

  router.use(
    "/staff",
    authorize("admin"),
    createStaffRouter(container.controllers.staff),
  );

  router.use(
    "/users",
    authorize("admin", "manager"),
    createUsersRouter(container.controllers.users),
  );

  return router;
};
