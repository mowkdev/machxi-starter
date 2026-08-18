import { Router } from "express";

import { noStore } from "../../core/middleware/index.js";
import type { HealthController } from "./health.controller.js";

/**
 * `/health` (ADR-0016) — unversioned, unauthenticated, not rate limited, and
 * mounted before the `/api/v1` segments so that a probe never depends on
 * anything the API layer does.
 *
 * `GET /` is the human-facing view and answers exactly what `/ready` does: the
 * resource already carries version, uptime and every check, so a second shape
 * would only be a second thing to keep in sync. The split that matters is
 * `live` (never touches a dependency) versus `ready` (does).
 */
export const createHealthRouter = (controller: HealthController): Router => {
  const router = Router();

  router.use(noStore);
  router.get("/live", controller.live);
  router.get("/ready", controller.ready);
  router.get("/", controller.ready);

  return router;
};
