import { Router } from "express";

import type { Container } from "../core/container.js";
import { authorize } from "../core/middleware/index.js";
import { createAuthRouter } from "../modules/auth/index.js";
import { createSettingsRouter } from "../modules/settings/index.js";
import {
  createStaffProfileRouter,
  createStaffRouter,
} from "../modules/staff/index.js";
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
 * - `/profile` carries **no** `authorize`, and that is the decision rather
 *   than an omission: every handler under it reads its subject from
 *   `ctx.principal`, there is no `:id` to compare, and every staff role —
 *   `editor` included — may read its own account and change its own password
 *   (ADR-0019 §3, ADR-0027).
 * - `/settings` carries none for word-for-word the same reason (ADR-0045):
 *   its subject is `ctx.principal` and it has no `:id` either. It is mounted
 *   beside `/profile` because it is the same kind of thing — the account
 *   acting on itself.
 * - `/staff` is `admin` throughout. Managing operators is not a manager's job.
 * - `/users` is `admin` **or** `manager` to read, and the router narrows its
 *   writing routes back to `admin` — six of them since `D13.4`, the sixth
 *   being the impersonation mint (ADR-0057 §1).
 *
 * `super_admin` bypasses both, on the single line in `authorize` that says so.
 */
export const createAdminRouter = (container: Container): Router => {
  const router = Router();

  router.use(
    "/auth",
    createAuthRouter({
      controller: container.controllers.staffAuth,
      cookieNames: container.cookieNames,
      authenticate: container.authenticate,
      population: "staff",
      loginRateLimiter: container.rateLimiters.login,
      refreshRateLimiter: container.rateLimiters.refresh,
      // Passed and never registered on this segment: the exchange exists only
      // where the population is `user` (ADR-0057 §3), and the condition that
      // says so lives in the router beside the route.
      impersonation: container.controllers.impersonation,
      // A no-op on this segment for the same reason: only a customer principal
      // can carry an actor (ADR-0057 §4), so nothing here can be refused by it.
      refuseImpersonated: container.refuseImpersonated,
    }),
  );

  router.use(container.authenticate("staff"));

  router.use(
    "/profile",
    createStaffProfileRouter(container.controllers.staffProfile),
  );

  router.use(
    "/settings",
    createSettingsRouter({
      controller: container.controllers.settings,
      population: "staff",
    }),
  );

  router.use(
    "/staff",
    authorize("admin"),
    createStaffRouter(container.controllers.staff),
  );

  router.use(
    "/users",
    authorize("admin", "manager"),
    createUsersRouter({
      controller: container.controllers.users,
      // `POST /users/:id/impersonate` (ADR-0057 §1) — narrowed to `admin` by
      // the route, and limited per staff principal by a limiter that must
      // therefore mount after this segment's `authenticate`.
      impersonation: {
        controller: container.controllers.impersonation,
        rateLimiter: container.rateLimiters.impersonation,
      },
    }),
  );

  return router;
};
