import { Router } from "express";

import type { Container } from "../core/container.js";

/**
 * `/api/v1/public/*` (ADR-0015) — no authentication.
 *
 * Routes that personalise for a signed-in user apply `authenticateOptional`
 * per route; nothing is guarded at this level, which is exactly why the
 * segment is separate from `/user` and `/admin`: "public" is a decision made
 * once, in the URL, not a guard someone can forget.
 *
 * Empty until step 8 mounts `POST /auth/register` behind
 * `FEATURE_USER_REGISTRATION`.
 */
export const createPublicRouter = (_container: Container): Router => {
  return Router();
};
