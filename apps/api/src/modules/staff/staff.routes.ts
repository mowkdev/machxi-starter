import { Router, type RequestHandler } from "express";

import { authorize, noStore, validate } from "../../core/middleware/index.js";
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
  resendStaffOnboardingSchema,
  revokeStaffSessionsSchema,
  setStaffEmailSchema,
  setStaffPasswordSchema,
  updateStaffProfileSchema,
  updateStaffSchema,
} from "./staff.schemas.js";

/**
 * `/api/v1/admin/staff/*` (ADR-0015).
 *
 * There is **one** guard in this file, and every other route deliberately has
 * none: the resource is `admin`-only, so the segment router mounts
 * `authenticate("staff")` and `authorize("admin")` once at the mount point and
 * every route below inherits them (ADR-0019 §2). A per-route `authorize`
 * repeating that would be a second place to keep in sync, and a route added
 * without one would look correct.
 *
 * The exception since `D18.10` is `POST /:id/email`, which *narrows* the mount
 * to `super_admin` (ADR-0071 §7). Narrowing is what ADR-0019 §2 permits and is
 * safe in this direction only, because both guards run.
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
export interface StaffRouterDeps {
  readonly controller: StaffController;
  /**
   * The mailbox's budget on ADR-0071 §8's two senders, from the composition
   * root (§8, amended at `D18.11`).
   *
   * One instance mounted twice, because both mail the same invitation to the
   * same mailbox. It sits **inside** the mount, so `authenticate` and
   * `authorize("admin")` have both already run — §5's stated refinement of
   * ADR-0011's order, and the reason for it: what is rationed is a stranger's
   * inbox, so a caller who is about to be refused for want of `admin` must
   * not be able to spend it.
   */
  readonly onboardingMailRateLimiter: RequestHandler;
  /**
   * ADR-0073 §1's per-principal budget, from the composition root — one
   * instance shared with the two `POST /admin/users/:id/{password,email}`
   * routes and the four `/user/profile` routes that spend a hash.
   *
   * This router carries two mounts, `POST /:id/password` and `POST /:id/email`,
   * and the reason is the sharper of the two §1 gives: the caller presents
   * their **own** current password on both, so each `403` is a guessing oracle
   * against the credential ADR-0027 rule 1 leans on. Keyed on the actor, so
   * they sit inside the mount, after `authenticate` and `authorize("admin")`.
   */
  readonly principalHashRateLimiter: RequestHandler;
}

export const createStaffRouter = ({
  controller,
  onboardingMailRateLimiter,
  principalHashRateLimiter,
}: StaffRouterDeps): Router => {
  const router = Router();

  router.use(noStore);

  router.get("/", validate(listStaffSchema), controller.list);
  /*
   * The limiter is on `create` because the body may name a **stranger's**
   * address and the endpoint may mail it (ADR-0071 §8, amended at `D18.11`).
   * It is keyed on that address, so a create that supplies a password — which
   * mails nothing — spends a budget it did not need; that is the trade
   * `skipFailedRequests: false` already makes everywhere else in §4, and the
   * alternative is a limiter that reads the body twice to decide whether to
   * count.
   */
  router.post(
    "/",
    onboardingMailRateLimiter,
    validate(createStaffSchema),
    controller.create,
  );

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
  //
  // The limiter is ADR-0073 §1's, keyed on the acting staff member: what it
  // bounds is their guessing at their own `currentPassword` and the argon2
  // operation each guess buys.
  router.post(
    "/:id/password",
    principalHashRateLimiter,
    validate(setStaffPasswordSchema),
    controller.setPassword,
  );

  /*
   * `POST /:id/email` (ADR-0071 §7) — **the one route in this file that
   * carries a guard**, and the exception the header paragraph above is written
   * against rather than a hole in it.
   *
   * The mount says `admin`; this narrows it to `super_admin`, which a route
   * may do and may never do in the other direction, because both run. The
   * reason it is not left to the mount is §7's own: setting an address
   * redirects every future recovery link for that account, so it is the one
   * operation here an `admin` may not perform on a peer — and there is nothing
   * in the service that could express that, because rank rules are about the
   * *subject's* standing and this is about the actor's.
   *
   * `authorize("super_admin")` rather than the bare `authorize()` that means
   * the same thing: a reader must not have to know that an empty list is a
   * lock in order to see which role this route is for.
   *
   * It carries **no mailbox limiter**, unlike the two §8 senders: nothing is
   * mailed here at all (§7). It does carry ADR-0073 §1's per-principal budget,
   * and for `/:id/password`'s reason rather than for a mailbox's: this route
   * verifies the **actor's own** password before it reads the subject, so its
   * `403` is the same oracle — on the super admin's credential (`D20.4`'s
   * `security-reviewer`).
   */
  router.post(
    "/:id/email",
    authorize("super_admin"),
    principalHashRateLimiter,
    validate(setStaffEmailSchema),
    controller.setEmail,
  );

  /*
   * `POST /:id/onboarding/resend` (ADR-0071 §8) — no guard of its own, and
   * that is the mount's `admin` rather than an omission: creating the invited
   * row is an `admin`'s right, so re-sending the message it already sent
   * cannot be a higher bar. There is nothing here for `super_admin` to
   * narrow, because the message goes to the address the row already holds —
   * unlike `POST /:id/email` above, which changes where every future link
   * lands.
   *
   * A sub-resource for the reason `sessions/revoke` and `password` are: it is
   * an action with a side effect outside this row — a message and a token —
   * rather than a field of the staff member.
   */
  router.post(
    "/:id/onboarding/resend",
    onboardingMailRateLimiter,
    validate(resendStaffOnboardingSchema),
    controller.resendOnboarding,
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
 * reason `/user/profile/change-password` gave before `D20.4`: the caller
 * already holds a valid session for the account whose password they are
 * "guessing", so what a successful guess buys is the plaintext rather than the
 * account. **It is deliberately not on ADR-0073 §1's list of five**, which
 * this router's `POST /:id/password` is: a staff member changing their own
 * password is the one route of this shape where the actor and the subject are
 * the same account, so there is no oracle, and its hashes are bounded by the
 * fact that a staff population is small and authenticated. The number of
 * routes on that list is the record's, and this file does not extend it.
 *
 * **That reasoning never extended to `POST /admin/{staff,users}/:id/password`
 * or to the `:id/email` pair beside them, and the D2.3 security review is
 * where that was noticed.** There the caller presents a password they may well
 * not know, so the `403` those endpoints answer is a guessing oracle against
 * the one credential ADR-0027 rule 1 leans on — bounded, until `D20.4`, only
 * by the global `300 / 15 min / IP`. It was
 * recorded in ADR-0027 §Consequences, amended D2.3, rather than half-closed
 * with a fifth limiter here, because rate limiting is ADR-0020's; ADR-0073 §1
 * is where that record's successor takes it, and the limiter is mounted above.
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
