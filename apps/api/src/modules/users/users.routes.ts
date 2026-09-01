import { Router, type RequestHandler } from "express";

import { authorize, noStore, validate } from "../../core/middleware/index.js";
import {
  mintImpersonationSchema,
  type ImpersonationController,
} from "../auth/index.js";
import type {
  UserProfileController,
  UsersController,
} from "./users.controller.js";
import {
  changePasswordSchema,
  createUserSchema,
  deleteProfileSchema,
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
 * *read* the customer base, and the five writing routes refine that to
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
export interface UsersRouterDeps {
  readonly controller: UsersController;
  /**
   * The impersonation mint (ADR-0057 §1), which lives at a `users` URL and in
   * the auth module.
   *
   * The route is here because `/admin/users/:id/impersonate` is a user
   * sub-resource and this is where a reader looks for one — the same shape
   * `POST /:id/sessions/revoke` has, whose work also belongs to the auth
   * module. Mounting a second router at `/users` was the alternative and was
   * rejected: `router.use("/users", authorize("admin"), …)` runs its guard for
   * every path under the prefix, so a second mount either refuses a manager's
   * `GET /users` or has no guard at its mount point at all.
   */
  readonly impersonation: {
    readonly controller: Pick<ImpersonationController, "mint">;
    /** Keyed on the staff principal's id, so it mounts after `authenticate` (ADR-0057 §1). */
    readonly rateLimiter: RequestHandler;
  };
}

export const createUsersRouter = ({
  controller,
  impersonation,
}: UsersRouterDeps): Router => {
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

  // `admin` only, never `manager` (ADR-0057 §1): reading the customer base is
  // a manager's job, and becoming a customer is not. `super_admin` passes on
  // the one line in `authorize` that says so.
  //
  // The limiter runs after `authorize` rather than before it, which is the
  // named refinement of ADR-0011's rate-limit-first order that ADR-0057 §1
  // makes: its key is `ctx.principal`, which does not exist before
  // `authenticate`, and an authenticated high-value operation wants a
  // per-actor budget rather than a per-IP one. A refused `manager` therefore
  // spends nothing, which is the right way round — the budget exists to bound
  // the operators who *can* mint.
  router.post(
    "/:id/impersonate",
    authorize("admin"),
    impersonation.rateLimiter,
    validate(mintImpersonationSchema),
    impersonation.controller.mint,
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
 * **Two endpoints now, not one** (`D12.4`): the `DELETE` below verifies a
 * password too, so it draws on the same pool for the same reason. It buys one
 * hash rather than two — there is no new credential to store — and it can be
 * called at most once per account, since it ends the session that called it.
 * The accepted risk is unchanged in kind and smaller in degree; the missing
 * category is still a per-principal budget for expensive routes, recorded in
 * ADR-0020 §Residual risks rather than half-built here.
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

  // Self-service deletion (ADR-0055 §4), on ADR-0028's user semantics: the row
  // survives soft-deleted, the address is released, and every session goes —
  // this one included, which is what separates it from `change-password`.
  //
  // A `DELETE` with a body, which is unusual and deliberate: the actor
  // re-authenticates with their current password, because a session is not an
  // identity proof for an irreversible act. There is no `:id` here either, so
  // the only account this can ever close is the caller's own (ADR-0019 §3).
  router.delete("/", validate(deleteProfileSchema), controller.remove);

  return router;
};
