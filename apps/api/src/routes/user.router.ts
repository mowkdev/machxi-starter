import { Router } from "express";

import type { Container } from "../core/container.js";
import { createAuthRouter } from "../modules/auth/index.js";
import {
  createUserInvitationsRouter,
  createUserOrganizationsRouter,
} from "../modules/organizations/index.js";
import { createSettingsRouter } from "../modules/settings/index.js";
import { createUserProfileRouter } from "../modules/users/index.js";

/**
 * `/api/v1/user/*` (ADR-0015) — requires a user principal.
 *
 * `/auth` is mounted first and guards itself: `login`, `refresh` and — since
 * `D13.4` — `impersonate` are how a client obtains a token, so they cannot sit
 * behind one, while `logout`, `logout-all` and `me` are guarded inside the
 * auth router.
 *
 * Everything registered *after* `authenticate("user")` requires one. The guard
 * goes on the router, not on each route, so a new endpoint is protected by
 * where it is mounted rather than by somebody remembering a decorator
 * (ADR-0019 §1).
 *
 * `/orgs` is the one prefix here that is **not** self-scoped: it addresses an
 * organization, and a third guard — `requireMembership`, mounted per route
 * inside its own router — resolves the caller's membership of it and refuses a
 * non-member with `404` (ADR-0067 §4). `/invitations` sits beside `/profile`
 * rather than under `/orgs`, because an invitee is not a member yet.
 *
 * There is no `authorize` in this segment and that is not an omission:
 * `customer` is the only user role in v1, so authentication already implies
 * it, and the profile endpoints address `ctx.principal` rather than an `:id`
 * — the ownership question ADR-0019 §3 asks has no way to be answered wrongly
 * when there is no id to compare. `/settings` joins on the same footing
 * (ADR-0045): same subject, same absence of an id, same table selected by the
 * population rather than by anything a request carries.
 */
export const createUserRouter = (container: Container): Router => {
  const router = Router();

  router.use(
    "/auth",
    createAuthRouter({
      controller: container.controllers.userAuth,
      cookieNames: container.cookieNames,
      authenticate: container.authenticate,
      population: "user",
      loginRateLimiter: container.rateLimiters.login,
      refreshRateLimiter: container.rateLimiters.refresh,
      // ADR-0071 §4's pair on `password/forgot`: one bounds what a single
      // sender may mail one mailbox, the other what that mailbox receives from
      // everybody. Both instances are the container's, so the counters are one
      // per deployment rather than one per segment.
      passwordResetRateLimiter: container.rateLimiters.passwordReset,
      mailboxRateLimiter: container.rateLimiters.mailbox,
      // The login limiter's numbers on `password/reset`, in a counter of its
      // own: the body carries no address, so its key is the caller's — the
      // same key a malformed `login` produces.
      passwordResetSubmitRateLimiter:
        container.rateLimiters.passwordResetSubmit,
      // `POST /user/auth/impersonate` (ADR-0057 §3) — registered here and
      // nowhere else, because the auth router is one factory per segment and
      // an admin-segment twin would turn a URL fragment into a staff session.
      impersonation: container.controllers.impersonation,
      // ADR-0057 §5: `logout-all` ends the customer's real sessions everywhere
      // and an impersonator may not.
      refuseImpersonated: container.refuseImpersonated,
    }),
  );

  router.use(container.authenticate("user"));

  router.use(
    "/profile",
    createUserProfileRouter({
      controller: container.controllers.userProfile,
      refuseImpersonated: container.refuseImpersonated,
    }),
  );

  router.use(
    "/settings",
    createSettingsRouter({
      controller: container.controllers.settings,
      population: "user",
    }),
  );

  /*
   * `/orgs` — the only prefix in this segment that is not self-scoped
   * (ADR-0067 §4, the delta on ADR-0015). Its own router mounts
   * `requireMembership` per route, because the roles differ per route; there
   * is deliberately no guard at this mount point, or `GET /orgs` — "which
   * organizations do I have" — would have to satisfy a membership it is
   * asking about.
   */
  router.use(
    "/orgs",
    createUserOrganizationsRouter({
      controller: container.controllers.userOrganizations,
      requireMembership: container.requireMembership,
      // ADR-0067 §8's grown list, read in the router file beside each route.
      refuseImpersonated: container.refuseImpersonated,
    }),
  );

  /*
   * `/invitations` — self-scoped like `/profile` and `/settings`, and outside
   * the `/orgs` prefix on purpose: the caller is not a member of anything yet,
   * which is what an invitation is for (ADR-0067 §4).
   */
  router.use(
    "/invitations",
    createUserInvitationsRouter({
      controller: container.controllers.userInvitations,
      refuseImpersonated: container.refuseImpersonated,
    }),
  );

  return router;
};
