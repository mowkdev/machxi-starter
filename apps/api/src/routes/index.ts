import { Router } from "express";

import type { Container } from "../core/container.js";
import { createHealthRouter } from "../modules/health/index.js";
import { createAdminRouter } from "./admin.router.js";
import { createPublicRouter } from "./public.router.js";
import { createUserRouter } from "./user.router.js";

/**
 * The URL map of the API (ADR-0015).
 *
 * `/health/*` is unversioned — an orchestrator's probe must not have to follow
 * an API version bump. Everything else lives under `/api/v1`, split into three
 * segments whose names state their authentication requirement, so a route's
 * guard is visible in its URL and enforced where it is mounted.
 */
export const API_V1_PREFIX = "/api/v1";

export const createRoutes = (container: Container): Router => {
  const router = Router();

  router.use("/health", createHealthRouter(container.controllers.health));

  router.use(`${API_V1_PREFIX}/public`, createPublicRouter(container));
  router.use(`${API_V1_PREFIX}/user`, createUserRouter(container));
  router.use(`${API_V1_PREFIX}/admin`, createAdminRouter(container));

  return router;
};
