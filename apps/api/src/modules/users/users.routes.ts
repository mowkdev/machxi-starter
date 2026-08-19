import { Router } from "express";

import { authorize, noStore, validate } from "../../core/middleware/index.js";
import type {
  UserProfileController,
  UsersController,
} from "./users.controller.js";
import {
  changePasswordSchema,
  createUserSchema,
  deleteUserSchema,
  getUserSchema,
  listUsersSchema,
  revokeUserSessionsSchema,
  setUserPasswordSchema,
  updateProfileSchema,
  updateUserSchema,
} from "./users.schemas.js";

/**
 * `/api/v1/admin/users/*` (ADR-0015).
 *
 * Unlike the staff router, this resource is not uniformly `admin`: the segment
 * mounts it behind `authorize("admin", "manager")` because a manager may
 * *read* the customer base, and the four writing routes refine that to
 * `authorize("admin")` (ADR-0019 §2). `super_admin` bypasses both, on the one
 * line in `authorize` where that is stated.
 *
 * Refining per route is what the ADR calls for and is safe in this direction
 * only: a route may narrow the mount's guard, never widen it, because both run.
 *
 * `no-store` covers the whole resource, for the reason it covers the staff one:
 * these responses are the customer list, and a page of it sitting in a shared
 * proxy is a data breach with a cache key (ADR-0020).
 */
export const createUsersRouter = (controller: UsersController): Router => {
  const router = Router();

  router.use(noStore);

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

  // `admin`, never `manager`: reading the customer base is a manager's job,
  // and rewriting a customer's credential is not. A sub-resource rather than a
  // field on `PATCH /:id`, so no code path exists where a profile edit can
  // silently rotate a password (ADR-0027).
  router.post(
    "/:id/password",
    authorize("admin"),
    validate(setUserPasswordSchema),
    controller.setPassword,
  );

  // A soft delete (ADR-0028): the row survives with `deleted_at` set, because
  // a customer record is referenced by future order history. `admin` only —
  // a manager reads the customer base and does not end accounts in it.
  router.delete(
    "/:id",
    authorize("admin"),
    validate(deleteUserSchema),
    controller.remove,
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
 * `change-password` gets no limiter of its own beyond the global one, and the
 * open question there is cost rather than guessing. Nothing is left to
 * brute-force — the caller already holds a valid session for the account whose
 * password they are "guessing" — but each call still buys up to two argon2
 * operations from a pool of `AUTH_MAX_CONCURRENT_HASHES` that login shares, and
 * the global `300 / 15 min / IP` is a per-IP budget rather than a per-account
 * one. A determined set of authenticated clients can therefore make the hash
 * limiter shed, and what it sheds is *login*, for everybody.
 *
 * Accepted for now: reaching it at all requires a valid session per client, the
 * global limiter caps each one, and the shedding is a `503` with `Retry-After`
 * rather than a failure (ADR-0020 §Residual risks). A per-principal budget for
 * expensive routes is the missing category, and it is recorded there rather
 * than half-built here.
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
