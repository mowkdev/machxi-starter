import { Router } from "express";

import type { Container } from "../core/container.js";
import { createMetricsRouter } from "../core/metrics/index.js";
import { createHealthRouter } from "../modules/health/index.js";
import { createAdminRouter } from "./admin.router.js";
import { createPublicRouter } from "./public.router.js";
import { createUserRouter } from "./user.router.js";

/**
 * The URL map of the API (ADR-0015).
 *
 * `/health/*` is unversioned — an orchestrator's probe must not have to follow
 * an API version bump. `/metrics` joins it there since `D14.6` (ADR-0066 §2,
 * the delta on ADR-0016): a scraper is an operator's tool, not a client of the
 * API, and it must not have to follow a version bump either. Everything else
 * lives under `/api/v1`, split into three segments whose names state their
 * authentication requirement, so a route's guard is visible in its URL and
 * enforced where it is mounted.
 */
export const API_V1_PREFIX = "/api/v1";

export const createRoutes = (container: Container): Router => {
  const router = Router();

  // Before the `/api/v1` mounts and after `/health`, which is the whole point
  // of the position: a probe that gets rate-limited takes a working instance
  // out of rotation, so health is deliberately outside every limiter
  // (ADR-0016, ADR-0020 §Residual risks).
  router.use("/health", createHealthRouter(container.controllers.health));

  // Beside `/health` and above the limiter for the same reason (ADR-0066 §2):
  // a scraper polling every fifteen seconds would spend the global budget by
  // lunchtime, and an instance whose `/metrics` answers 429 looks down to the
  // monitoring that is supposed to tell you it is up. It carries its own
  // access control instead — a bearer token whenever one is configured, which
  // production has no way to skip.
  router.use(
    "/metrics",
    createMetricsRouter({
      metrics: container.metrics,
      token: container.config.metrics.token,
    }),
  );

  router.use(API_V1_PREFIX, container.rateLimiters.global);

  router.use(`${API_V1_PREFIX}/public`, createPublicRouter(container));
  router.use(`${API_V1_PREFIX}/user`, createUserRouter(container));
  router.use(`${API_V1_PREFIX}/admin`, createAdminRouter(container));

  return router;
};
