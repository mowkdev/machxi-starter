import { Router, type RequestHandler } from "express";

import { authorize, noStore, validate } from "../../core/middleware/index.js";
import {
  federatedStartSchema,
  mintImpersonationSchema,
  type FederatedController,
  type ImpersonationController,
} from "../auth/index.js";
import type {
  UserProfileController,
  UsersController,
} from "./users.controller.js";
import {
  changeEmailSchema,
  changePasswordSchema,
  createUserSchema,
  deleteProfileSchema,
  deleteUserSchema,
  getUserSchema,
  listUsersSchema,
  revokeUserSessionsSchema,
  setUserEmailSchema,
  setUserPasswordSchema,
  unlinkIdentitySchema,
  updateProfileSchema,
  updateUserSchema,
} from "./users.schemas.js";

/**
 * `/api/v1/admin/users/*` (ADR-0015).
 *
 * Unlike the staff router, this resource is not uniformly `admin`: the segment
 * mounts it behind `authorize("admin", "manager")` because a manager may
 * *read* the customer base, and the writing routes refine that per route
 * (ADR-0019 §2) — six to `authorize("admin")` and, since `D18.10`, one to
 * `authorize("super_admin")`. `super_admin` bypasses every one of them, on the
 * one line in `authorize` where that is stated.
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
  /**
   * The per-principal budget on every route that verifies a password under a
   * session (ADR-0073 §1), from the composition root.
   *
   * One instance across all of its mounts, and this router carries two:
   * `POST /:id/password` and `POST /:id/email` both verify the **actor's own**
   * current password before the subject is read, so each `403` is a guessing
   * oracle against the credential ADR-0027 rule 1 leans on — until `D20.4`
   * bounded by nothing but the global per-address limit. Keyed on the actor,
   * so both mount after `authorize`.
   */
  readonly principalHashRateLimiter: RequestHandler;
}

export const createUsersRouter = ({
  controller,
  impersonation,
  principalHashRateLimiter,
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
  //
  // The limiter is ADR-0073 §1's, and it mounts **after** `authorize` for
  // `impersonate`'s reason below: its key is `ctx.principal`, and a `manager`
  // refused here should spend nothing. What it bounds is the actor's own
  // guessing at their own password — the `403` this route answers when
  // `currentPassword` is wrong — and the argon2 operation each attempt buys.
  router.post(
    "/:id/password",
    authorize("admin"),
    principalHashRateLimiter,
    validate(setUserPasswordSchema),
    controller.setPassword,
  );

  /*
   * `POST /:id/email` (ADR-0071 §7) — **the first route in this API guarded on
   * `super_admin` alone.**
   *
   * A sub-resource for `POST /:id/password`'s reason and one narrower still:
   * setting an address is an action with side effects — every future recovery
   * link now goes somewhere else — and ADR-0071 rejected the alternative by
   * name, an `email` field on `PATCH /:id` accepted only for a super admin,
   * because a body field whose acceptance depends on the caller's role is a
   * second authorization mechanism beside ADR-0019's guards.
   *
   * `authorize("super_admin")` rather than the bare `authorize()` that means
   * the same thing: the guard is the record's sentence, and a reader must not
   * have to know that an empty list is a lock to see which role this is.
   */
  //
  // The limiter is `/:id/password`'s, and this route is on §1's list for
  // exactly its reason (`D20.4`'s `security-reviewer`): `setEmail` verifies
  // the **actor's own** password before it reads the subject, so its `403` is
  // the same oracle — on the super admin's credential, which is the worst one
  // to leave unbounded.
  router.post(
    "/:id/email",
    authorize("super_admin"),
    principalHashRateLimiter,
    validate(setUserEmailSchema),
    controller.setEmail,
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
 * **Four routes here spend an argon2 operation under a session**, and since
 * `D20.4` they share a budget keyed on the account that spends it (ADR-0073
 * §1). `change-password` buys up to two hashes, the `DELETE` below buys one —
 * there is no new credential to store — `DELETE /identities/:provider`
 * (`D19.4`, ADR-0072 §3) buys one, refused before any hash for an account with
 * no password, and `change-email` (ADR-0071 §6) buys one too, which is the
 * fourth that §1's first list missed. What was never bounded is what they buy
 * it *from*: a pool of
 * `AUTH_MAX_CONCURRENT_HASHES` that login shares, behind a global `300 / 15
 * min / **IP**` that is a per-address budget rather than a per-account one. A
 * determined set of authenticated clients could therefore make the hash
 * limiter shed, and what it sheds is *login*, for everybody.
 *
 * That is the fifth limiter category ADR-0020 §Residual risks named as missing
 * from D1 onwards, and it is now mounted rather than accepted: `10 / 15 min`
 * per principal, one counter across all five of its routes.
 */
export interface UserProfileRouterDeps {
  readonly controller: UserProfileController;
  /**
   * The mailbox's own budget on `change-email` (ADR-0071 §6, amended at
   * `D18.9`), keyed on `newEmail` and counted in an instance of its own.
   *
   * Mounted **after** `refuseImpersonated` rather than first, which is the
   * refinement of ADR-0011's rate-limit-first order that ADR-0071 §5 states
   * for the invitation and that applies here word for word: what is rationed
   * is a third party's inbox, so a caller who is going to be refused anyway
   * must not be able to spend it — or the limiter becomes the denial.
   */
  readonly mailboxRateLimiter: RequestHandler;
  /**
   * ADR-0057 §5's exclusion guard, on the operations here that would let an
   * impersonator take the account over (ADR-0019's declarative style).
   *
   * `PATCH /` is deliberately **not** guarded: a profile edit is what support
   * opens the app to do, it cannot move the address (ADR-0055 §4 keeps the
   * email off this body), and every one of them lands in the audit table with
   * both identities on it.
   */
  readonly refuseImpersonated: RequestHandler;
  /**
   * The set-password link's budget (ADR-0072 §3, amended at `D19.4`) — the
   * recovery limiter's number keyed on the caller's account, in a counter of
   * its own. Mounted after `refuseImpersonated` for `mailboxRateLimiter`'s
   * reason: a caller who is about to be refused must not spend the mailbox's
   * budget.
   */
  readonly setPasswordLinkRateLimiter: RequestHandler;
  /**
   * ADR-0073 §1's per-principal budget on the four routes here that spend an
   * argon2 operation, from the composition root — one instance shared with the
   * administrative credential and address resets, because what it rations is
   * the caller's share of one process-wide hash pool rather than any one route.
   *
   * Mounted **after** `refuseImpersonated` for `mailboxRateLimiter`'s reason
   * and one of its own: a request the guard is going to refuse buys no hash at
   * all, and its budget would be charged to the impersonated **customer**.
   */
  readonly principalHashRateLimiter: RequestHandler;
  /**
   * The link start's handler (ADR-0072 §3), **present only when the Google
   * client is configured** — the federated controller exists then and not
   * otherwise — so without one the path answers `404 ROUTE_NOT_FOUND`, the
   * public start's shape. Unlinking is mounted whatever this says: an account
   * may hold an identity on a deployment that has since dropped its client,
   * and removing a way in needs nothing from Google.
   */
  readonly federated?: Pick<FederatedController, "startLink"> | undefined;
}

export const createUserProfileRouter = ({
  controller,
  refuseImpersonated,
  mailboxRateLimiter,
  principalHashRateLimiter,
  setPasswordLinkRateLimiter,
  federated,
}: UserProfileRouterDeps): Router => {
  const router = Router();

  router.use(noStore);

  router.get("/", controller.get);
  router.patch("/", validate(updateProfileSchema), controller.update);
  // Before `validate`, and that is the ADR-0011 order rather than an exception
  // to it: this is a guard, and a request that fails it must not first have a
  // body carrying two passwords parsed to produce a better error message.
  router.post(
    "/change-password",
    refuseImpersonated,
    principalHashRateLimiter,
    validate(changePasswordSchema),
    controller.changePassword,
  );

  /*
   * `POST /change-email` (ADR-0071 §6) — asking to move to a new address.
   *
   * `refuseImpersonated` before `validate`, exactly as `change-password` has
   * it and for the identical reason: it is a guard, so a request that fails it
   * must not first have a body carrying a password parsed to produce a better
   * error message.
   *
   * **The third entry on ADR-0057 §5's list from this router**, and the one
   * with the sharpest argument for being there. A support operator who could
   * move a customer's address would redirect every future recovery link to a
   * mailbox of their choosing — the account is theirs from the next `forgot`
   * onwards, without the password ever being known — which is the definition
   * of takeover-enabling that list is drawn from. `PATCH /` stays off it
   * because `updateProfileBody` cannot carry an address at all, and that is
   * now load-bearing rather than incidental.
   */
  router.post(
    "/change-email",
    refuseImpersonated,
    // Before `mailboxRateLimiter`, and it is a second budget rather than a
    // duplicate of it (`D20.4`'s `security-reviewer`). That one is keyed on
    // the address the caller typed and **refunds every refusal**, for the
    // reason its own docblock gives — so a wrong `currentPassword` here used
    // to buy an argon2 operation from login's pool and spend no budget at all.
    // This one is keyed on the account and counts refusals, which is what the
    // hash is protected by; running it first also keeps a caller who is over
    // their own budget away from the mailbox's counter entirely.
    principalHashRateLimiter,
    mailboxRateLimiter,
    validate(changeEmailSchema),
    controller.changeEmail,
  );

  /*
   * The credentials an account keeps (ADR-0072 §3) — three more entries on
   * ADR-0057 §5's list from this router, each `refuseImpersonated` first, and
   * each for the list's own test: linking attaches a way in that outlives the
   * impersonated session, unlinking severs the owner's, and a set-password
   * link is a credential mailed on the session's say-so.
   *
   * **No CSRF guard here, and none is missing.** ADR-0072 §3 calls the link
   * start "CSRF-guarded", and on this router that is what the bearer token
   * already is (ADR-0029 §Decision: an access token in memory is never
   * attached to a request the person did not make, so no bearer route needs
   * the double-submit check). The double-submit guard fires only on a request
   * leaning on the refresh cookie, which is scoped to `/user/auth` and never
   * reaches `/user/profile` — mounted here it would be inert.
   *
   * `password/set-link` takes no body and so no `validate`: the account is
   * `ctx.principal`, the address is its own and the locale its row's.
   */
  router.post(
    "/password/set-link",
    refuseImpersonated,
    setPasswordLinkRateLimiter,
    controller.passwordSetLink,
  );

  // No limiter of its own: a start costs a signature, the session is the
  // credential, and the callback — the half that costs Google a request —
  // carries the budget it has always carried (ADR-0072 §2, amended at
  // `D19.2`). The global limiter covers the rest.
  if (federated !== undefined) {
    router.post(
      "/identities/google/start",
      refuseImpersonated,
      validate(federatedStartSchema),
      federated.startLink,
    );
  }

  router.delete(
    "/identities/:provider",
    refuseImpersonated,
    principalHashRateLimiter,
    validate(unlinkIdentitySchema),
    controller.unlinkIdentity,
  );

  // Self-service deletion (ADR-0055 §4), on ADR-0028's user semantics: the row
  // survives soft-deleted, the address is released, and every session goes —
  // this one included, which is what separates it from `change-password`.
  //
  // A `DELETE` with a body, which is unusual and deliberate: the actor
  // re-authenticates with their current password, because a session is not an
  // identity proof for an irreversible act. There is no `:id` here either, so
  // the only account this can ever close is the caller's own (ADR-0019 §3).
  router.delete(
    "/",
    refuseImpersonated,
    principalHashRateLimiter,
    validate(deleteProfileSchema),
    controller.remove,
  );

  return router;
};
