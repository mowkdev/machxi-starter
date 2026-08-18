import { Router } from "express";

import type { Container } from "../core/container.js";
import { createLoginRateLimiter } from "../core/middleware/index.js";
import { createRegisterRouter } from "../modules/auth/index.js";

/**
 * `/api/v1/public/*` (ADR-0015) — no authentication.
 *
 * Routes that personalise for a signed-in user apply `authenticateOptional`
 * per route; nothing is guarded at this level, which is exactly why the
 * segment is separate from `/user` and `/admin`: "public" is a decision made
 * once, in the URL, not a guard someone can forget.
 *
 * Self-registration is the only endpoint here in the first deliverable, and it
 * is mounted **conditionally**. With `FEATURE_USER_REGISTRATION` off the path
 * simply does not exist and answers `ROUTE_NOT_FOUND`, rather than a `403`
 * that would confirm the feature is there and merely switched off (ADR-0004).
 */
export const createPublicRouter = (container: Container): Router => {
  const router = Router();

  if (container.config.features.userRegistration) {
    router.use(
      "/auth",
      createRegisterRouter({
        controller: container.controllers.userAuth,
        // Registration hashes a password and creates a session exactly like
        // login does, so it shares login's limit (ADR-0018, amended step 4).
        rateLimiter: createLoginRateLimiter(container.config),
      }),
    );
  }

  return router;
};
