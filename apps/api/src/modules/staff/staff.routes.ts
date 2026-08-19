import { Router } from "express";

import { noStore, validate } from "../../core/middleware/index.js";
import type {
  StaffController,
  StaffProfileController,
} from "./staff.controller.js";
import {
  changeStaffPasswordSchema,
  createStaffSchema,
  deleteStaffSchema,
  getStaffSchema,
  listStaffSchema,
  revokeStaffSessionsSchema,
  setStaffPasswordSchema,
  updateStaffProfileSchema,
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
 *
 * `no-store` covers the whole resource. Every response here is a directory of
 * operators — addresses, names, roles, last sign-in — and a shared proxy that
 * kept a page of it would be holding the org chart of everyone who can reach
 * the admin panel. RFC 9111 already stops a shared cache storing a response to
 * a request carrying `Authorization`, so this is the belt to that suspenders,
 * and it is the same directive the auth router applies for the same reason
 * (ADR-0020).
 */
export const createStaffRouter = (controller: StaffController): Router => {
  const router = Router();

  router.use(noStore);

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

  // A sub-resource for the same reason, and one with more at stake: setting
  // somebody else's credential is an action with side effects, not an
  // attribute of the account. Keeping it off `PATCH /:id` is also what keeps
  // `updateStaffBody` free of a password field, so no code path exists where a
  // profile edit can silently rotate a credential (ADR-0027).
  router.post(
    "/:id/password",
    validate(setStaffPasswordSchema),
    controller.setPassword,
  );

  // A hard delete: the row goes and `staff_roles` cascades with it (ADR-0028).
  // `admin` like everything else in this router, which the mount already says
  // — the rules a guard cannot express (rank, the last super admin, and that
  // nobody deletes themselves) are the service's.
  router.delete("/:id", validate(deleteStaffSchema), controller.remove);

  return router;
};

/**
 * `/api/v1/admin/profile/*` (ADR-0015, ADR-0027).
 *
 * The mirror of `/api/v1/user/profile`, and like it this file carries no
 * guard: the segment mounts `authenticate("staff")` above it and being that
 * staff member *is* the authorization. There is no `:id` to compare — every
 * handler reads the account from `ctx.principal` — and every staff role,
 * `editor` included, may change its own password. An `authorize` here would be
 * a guard on an ownership question that cannot be answered wrongly (ADR-0019
 * §3).
 *
 * `no-store` covers the whole router. The profile is personal data about an
 * employee and the change-password request carries two passwords in its body;
 * neither belongs in a shared proxy's cache or on its disk (ADR-0020).
 *
 * `change-password` gets no limiter of its own beyond the global one, for the
 * reason `/user/profile/change-password` gives: the caller already holds a
 * valid session for the account whose password they are "guessing", so what a
 * successful guess buys is the plaintext rather than the account. Each call
 * still buys argon2 operations from the `AUTH_MAX_CONCURRENT_HASHES` pool that
 * login shares, and ADR-0027 §Consequences adds this route to the list the
 * missing per-principal budget for expensive routes will cover.
 *
 * **That reasoning does not extend to `POST /admin/{staff,users}/:id/password`,
 * and the D2.3 security review is where that was noticed.** There the caller
 * presents a password they may well not know, so the `403` those endpoints
 * answer is a guessing oracle against the one credential ADR-0027 rule 1 leans
 * on, bounded only by the global `300 / 15 min / IP`. It is recorded in
 * ADR-0027 §Consequences, amended D2.3, rather than half-closed with a fifth
 * limiter here: rate limiting is ADR-0020's, and ADR-0020 belongs to shipped
 * D1.
 */
export const createStaffProfileRouter = (
  controller: StaffProfileController,
): Router => {
  const router = Router();

  router.use(noStore);

  router.get("/", controller.get);
  router.patch("/", validate(updateStaffProfileSchema), controller.update);
  router.post(
    "/change-password",
    validate(changeStaffPasswordSchema),
    controller.changePassword,
  );

  return router;
};
