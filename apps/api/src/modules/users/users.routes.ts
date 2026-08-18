import { Router } from "express";

import { authorize, noStore, validate } from "../../core/middleware/index.js";
import type {
  UserProfileController,
  UsersController,
} from "./users.controller.js";
import {
  changePasswordSchema,
  createUserSchema,
  getUserSchema,
  listUsersSchema,
  revokeUserSessionsSchema,
  updateProfileSchema,
  updateUserSchema,
} from "./users.schemas.js";

/**
 * `/api/v1/admin/users/*` (ADR-0015).
 *
 * Unlike the staff router, this resource is not uniformly `admin`: the segment
 * mounts it behind `authorize("admin", "manager")` because a manager may
 * *read* the customer base, and the three writing routes refine that to
 * `authorize("admin")` (ADR-0019 §2). `super_admin` bypasses both, on the one
 * line in `authorize` where that is stated.
 *
 * Refining per route is what the ADR calls for and is safe in this direction
 * only: a route may narrow the mount's guard, never widen it, because both run.
 */
export const createUsersRouter = (controller: UsersController): Router => {
  const router = Router();

  router.get("/", validate(listUsersSchema), controller.list);
  router.post(
    "/",
    authorize("admin"),
    validate(createUserSchema),
    controller.create,
  );

  router.get("/:id", validate(getUserSchema), controller.getById);
  router.patch(
    "/:id",
    authorize("admin"),
    validate(updateUserSchema),
    controller.update,
  );

  router.post(
    "/:id/sessions/revoke",
    authorize("admin"),
    validate(revokeUserSessionsSchema),
    controller.revokeSessions,
  );

  return router;
};

/**
 * `/api/v1/user/profile/*` (ADR-0015).
 *
 * No guard in this file either: the segment mounts `authenticate("user")`
 * above it, and being that user *is* the authorization — there is no `:id` to
 * compare against, because every handler reads the account from
 * `ctx.principal` (ADR-0019 §3).
 *
 * `no-store` applies to the whole router. The profile is personal data and the
 * change-password request carries two passwords in its body; neither belongs
 * in a shared proxy's cache or on its disk (ADR-0020).
 *
 * `change-password` gets no limiter of its own beyond the global one: the only
 * caller who can reach it already holds a valid session for the account whose
 * password is being guessed, so there is nothing left to brute-force. What it
 * does cost is two argon2 operations, and those are bounded by the process-wide
 * hash limiter rather than per client.
 */
export const createUserProfileRouter = (
  controller: UserProfileController,
): Router => {
  const router = Router();

  router.use(noStore);

  router.get("/", controller.get);
  router.patch("/", validate(updateProfileSchema), controller.update);
  router.post(
    "/change-password",
    validate(changePasswordSchema),
    controller.changePassword,
  );

  return router;
};
