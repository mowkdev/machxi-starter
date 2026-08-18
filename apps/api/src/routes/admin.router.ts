import { Router } from "express";

import type { Container } from "../core/container.js";

/**
 * `/api/v1/admin/*` (ADR-0015) — requires a staff principal.
 *
 * The shape step 8 and step 9 fill in:
 *
 * ```ts
 * router.use("/auth", createStaffAuthRouter(c));
 * router.use(authenticate("staff"));
 * router.use("/staff", authorize("super_admin", "admin"), createStaffRouter(c));
 * router.use("/users", authorize("super_admin", "admin", "manager"), createUsersRouter(c));
 * ```
 */
export const createAdminRouter = (_container: Container): Router => {
  return Router();
};
