import { Router } from "express";

import type { Container } from "../core/container.js";

/**
 * `/api/v1/user/*` (ADR-0015) — requires a user principal.
 *
 * The shape step 8 fills in:
 *
 * ```ts
 * router.use("/auth", createUserAuthRouter(c));   // login/refresh are the entry point
 * router.use(authenticate("user"));               // everything below needs a principal
 * router.use("/profile", createUserProfileRouter(c));
 * ```
 *
 * The guard sits on the router, not on each route, so a new endpoint is
 * protected by where it is mounted rather than by remembering a decorator.
 */
export const createUserRouter = (_container: Container): Router => {
  return Router();
};
