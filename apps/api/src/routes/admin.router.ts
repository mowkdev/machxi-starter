import { Router } from "express";

import type { Container } from "../core/container.js";
import { authorize } from "../core/middleware/index.js";
import { createAuthRouter } from "../modules/auth/index.js";
import { createOrganizationsRouter } from "../modules/organizations/index.js";
import { createSettingsRouter } from "../modules/settings/index.js";
import {
  createStaffProfileRouter,
  createStaffRouter,
} from "../modules/staff/index.js";
import { createUsersRouter } from "../modules/users/index.js";

/**
 * `/api/v1/admin/*` (ADR-0015) — requires a staff principal.
 *
 * `/auth` is mounted first because `login` and `refresh` are how staff obtain
 * a token; everything inside it that needs one guards itself. Everything
 * registered *after* `authenticate("staff")` is protected by where it sits
 * rather than by somebody remembering a decorator (ADR-0019 §1).
 *
 * Each resource declares its role guard here, at the mount point — a resource
 * router without one is a review failure (ADR-0019 §Rules), and putting them
 * side by side is what makes "who may touch what" readable in one place:
 *
 * - `/profile` carries **no** `authorize`, and that is the decision rather
 *   than an omission: every handler under it reads its subject from
 *   `ctx.principal`, there is no `:id` to compare, and every staff role —
 *   `editor` included — may read its own account and change its own password
 *   (ADR-0019 §3, ADR-0027).
 * - `/settings` carries none for word-for-word the same reason (ADR-0045):
 *   its subject is `ctx.principal` and it has no `:id` either. It is mounted
 *   beside `/profile` because it is the same kind of thing — the account
 *   acting on itself.
 * - `/staff` is `admin` throughout. Managing operators is not a manager's job.
 * - `/users` is `admin` **or** `manager` to read, and the router narrows its
 *   writing routes back to `admin` — six of them since `D13.4`, the sixth
 *   being the impersonation mint (ADR-0057 §1).
 *
 * - `/organizations` is the users resource's shape exactly (ADR-0067 §3):
 *   `admin` **or** `manager` to read the tenant base, every writing route
 *   narrowed back to `admin` by its own router. Staff are never members, so
 *   nothing here mounts `requireMembership` and every organization is visible,
 *   soft-deleted ones included.
 *
 * `super_admin` bypasses both, on the single line in `authorize` that says so.
 */
export const createAdminRouter = (container: Container): Router => {
  const router = Router();

  router.use(
    "/auth",
    createAuthRouter({
      controller: container.controllers.staffAuth,
      cookieNames: container.cookieNames,
      authenticate: container.authenticate,
      population: "staff",
      loginRateLimiter: container.rateLimiters.login,
      refreshRateLimiter: container.rateLimiters.refresh,
      // ADR-0071 §4's pair on `password/forgot`: one bounds what a single
      // sender may mail one mailbox, the other what that mailbox receives from
      // everybody. Both instances are the container's, so the counters are one
      // per deployment rather than one per segment.
      passwordResetRateLimiter: container.rateLimiters.passwordReset,
      mailboxRateLimiter: container.rateLimiters.mailbox,
      // ADR-0071 §4's third key (amended at `D18.7`), keyed on the source
      // alone and shared with `register` and `resend-verification`: the two
      // above both carry the address the request names, so neither can see
      // one source walking a list of strangers' mailboxes.
      mailSourceRateLimiter: container.rateLimiters.mailSource,
      // The login limiter's numbers on `password/reset`, in a counter of its
      // own: the body carries no address, so its key is the caller's — the
      // same key a malformed `login` produces.
      passwordResetSubmitRateLimiter:
        container.rateLimiters.passwordResetSubmit,
      // The same numbers on `onboarding/accept`, in its own counter (ADR-0071
      // §8). Registered on this segment and only this one — the condition is
      // in the router, beside the route.
      onboardingAcceptRateLimiter: container.rateLimiters.onboardingAccept,
      // Passed and never registered on this segment: the exchange exists only
      // where the population is `user` (ADR-0057 §3), and the condition that
      // says so lives in the router beside the route.
      impersonation: container.controllers.impersonation,
      // A no-op on this segment for the same reason: only a customer principal
      // can carry an actor (ADR-0057 §4), so nothing here can be refused by it.
      refuseImpersonated: container.refuseImpersonated,
    }),
  );

  router.use(container.authenticate("staff"));

  router.use(
    "/profile",
    createStaffProfileRouter(container.controllers.staffProfile),
  );

  router.use(
    "/settings",
    createSettingsRouter({
      controller: container.controllers.settings,
      population: "staff",
    }),
  );

  router.use(
    "/staff",
    authorize("admin"),
    createStaffRouter({
      controller: container.controllers.staff,
      // ADR-0071 §8's mailbox budget (amended at `D18.11`), mounted on both of
      // that section's senders from one instance — they mail one message to
      // one mailbox, so a counter each would be two budgets for one flow.
      onboardingMailRateLimiter: container.rateLimiters.staffOnboardingMailbox,
      // ADR-0073 §1's per-principal budget on `POST /staff/:id/password` and
      // `POST /staff/:id/email`, where the actor presents their own credential
      // and each `403` is otherwise an unbounded oracle. One instance, shared
      // with the users router below and with `/user/profile`.
      principalHashRateLimiter: container.rateLimiters.principalHash,
    }),
  );

  router.use(
    "/users",
    authorize("admin", "manager"),
    createUsersRouter({
      controller: container.controllers.users,
      // `POST /users/:id/impersonate` (ADR-0057 §1) — narrowed to `admin` by
      // the route, and limited per staff principal by a limiter that must
      // therefore mount after this segment's `authenticate`.
      impersonation: {
        controller: container.controllers.impersonation,
        rateLimiter: container.rateLimiters.impersonation,
      },
      // The same instance the staff router takes (ADR-0073 §1): the budget is
      // one account's share of one hash pool, not a per-route allowance.
      principalHashRateLimiter: container.rateLimiters.principalHash,
    }),
  );

  router.use(
    "/organizations",
    authorize("admin", "manager"),
    createOrganizationsRouter(container.controllers.organizations),
  );

  return router;
};
