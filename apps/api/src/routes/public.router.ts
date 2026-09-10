import { Router } from "express";

import type { Container } from "../core/container.js";
import {
  createRegisterRouter,
  createVerificationRouter,
} from "../modules/auth/index.js";

/**
 * `/api/v1/public/*` (ADR-0015) — no authentication.
 *
 * Routes that personalise for a signed-in user apply `authenticateOptional`
 * per route; nothing is guarded at this level, which is exactly why the
 * segment is separate from `/user` and `/admin`: "public" is a decision made
 * once, in the URL, not a guard someone can forget.
 *
 * Self-registration is mounted **conditionally**. With
 * `FEATURE_USER_REGISTRATION` off the path simply does not exist and answers
 * `ROUTE_NOT_FOUND`, rather than a `403` that would confirm the feature is
 * there and merely switched off (ADR-0004).
 *
 * The two verification endpoints (ADR-0071 §3) are mounted **unconditionally**
 * beside it, on the same `/auth` prefix. Two mounts of one prefix rather than
 * one router with a branch inside it, because the condition is about
 * registration and not about verification: a staff member may create a
 * `pending_verification` account with the feature off, and a person who signed
 * up while it was on must not find the link in their mailbox answering `404`.
 */
export const createPublicRouter = (container: Container): Router => {
  const router = Router();

  if (container.config.features.userRegistration) {
    router.use(
      "/auth",
      createRegisterRouter({
        controller: container.controllers.userAuth,
        // Registration hashes a password exactly as login does, so it shares
        // login's limiter — the same instance, and therefore the same counter
        // (ADR-0018, amended step 4). It no longer creates a session
        // (ADR-0071 §3), but the argon2 cost that limiter really rations is
        // unchanged.
        rateLimiter: container.rateLimiters.login,
      }),
    );
  }

  router.use(
    "/auth",
    createVerificationRouter({
      controller: container.controllers.userAuth,
      // The verification half of ADR-0071 §4's budget, in a counter of its own
      // so a person stuck on verification cannot spend the recovery budget for
      // the same mailbox.
      rateLimiter: container.rateLimiters.verification,
    }),
  );

  return router;
};
