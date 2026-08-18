import { Router } from "express";

import { validate } from "../../core/middleware/index.js";
import type { StaffController } from "./staff.controller.js";
import {
  createStaffSchema,
  getStaffSchema,
  listStaffSchema,
  revokeStaffSessionsSchema,
  updateStaffSchema,
} from "./staff.schemas.js";

/**
 * `/api/v1/admin/staff/*` (ADR-0015).
 *
 * There is no guard in this file, and that is deliberate: the whole resource
 * is `admin`-only, so the segment router mounts `authenticate("staff")` and
 * `authorize("admin")` once at the mount point and every route below inherits
 * them (ADR-0019 §2). A per-route `authorize` here would be a second place to
 * keep in sync, and a route added without one would look correct.
 *
 * The order within a route is the one ADR-0011 fixes:
 * `rateLimit → authenticate → authorize → validate → controller`.
 */
export const createStaffRouter = (controller: StaffController): Router => {
  const router = Router();

  router.get("/", validate(listStaffSchema), controller.list);
  router.post("/", validate(createStaffSchema), controller.create);

  router.get("/:id", validate(getStaffSchema), controller.getById);
  router.patch("/:id", validate(updateStaffSchema), controller.update);

  // A sub-resource rather than `PATCH /:id { sessions: [] }`: ending somebody
  // else's sessions is an action with a side effect, not a field of the staff
  // member, and `POST` is what says so.
  router.post(
    "/:id/sessions/revoke",
    validate(revokeStaffSessionsSchema),
    controller.revokeSessions,
  );

  return router;
};
