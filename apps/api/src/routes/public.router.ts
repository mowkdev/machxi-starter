import { Router } from "express";

import type { Container } from "../core/container.js";
import {
  createFederatedRouter,
  createRegisterRouter,
  createVerificationRouter,
} from "../modules/auth/index.js";
import { createPublicInvitationsRouter } from "../modules/organizations/index.js";

/**
 * `/api/v1/public/*` (ADR-0015) — no authentication.
 *
 * Routes that personalise for a signed-in user apply `authenticateOptional`
 * per route; nothing is guarded at this level, which is exactly why the
 * segment is separate from `/user` and `/admin`: "public" is a decision made
 * once, in the URL, not a guard someone can forget.
 *
 * Self-registration is mounted **conditionally**. With
 * `FEATURE_USER_REGISTRATION` off the path simply does not exist and answers
 * `ROUTE_NOT_FOUND`, rather than a `403` that would confirm the feature is
 * there and merely switched off (ADR-0004).
 *
 * The two verification endpoints (ADR-0071 §3) are mounted **unconditionally**
 * beside it, on the same `/auth` prefix. Two mounts of one prefix rather than
 * one router with a branch inside it, because the condition is about
 * registration and not about verification: a staff member may create a
 * `pending_verification` account with the feature off, and a person who signed
 * up while it was on must not find the link in their mailbox answering `404`.
 */
export const createPublicRouter = (container: Container): Router => {
  const router = Router();

  if (container.config.features.userRegistration) {
    router.use(
      "/auth",
      createRegisterRouter({
        controller: container.controllers.userAuth,
        // Registration hashes a password exactly as login does, so it shares
        // login's limiter — the same instance, and therefore the same counter
        // (ADR-0018, amended step 4). It no longer creates a session
        // (ADR-0071 §3), but the argon2 cost that limiter really rations is
        // unchanged.
        rateLimiter: container.rateLimiters.login,
        // §4's source-keyed budget (amended at `D18.7`), the same instance
        // both other senders take: registration mails a link to an address
        // the caller typed, and the login limiter beside it keys on
        // `IP + email`, so it resets on every new address a walk names.
        mailSourceRateLimiter: container.rateLimiters.mailSource,
      }),
    );
  }

  router.use(
    "/auth",
    createVerificationRouter({
      controller: container.controllers.userAuth,
      // The verification half of ADR-0071 §4's budget, in a counter of its own
      // so a person stuck on verification cannot spend the recovery budget for
      // the same mailbox.
      rateLimiter: container.rateLimiters.verification,
      mailSourceRateLimiter: container.rateLimiters.mailSource,
    }),
  );

  /*
   * `/auth/google/{start,callback,exchange}` (ADR-0072 §2), mounted **only
   * when the Google client is configured** — the container builds the
   * controller then and not otherwise — so without one the three paths
   * answer `ROUTE_NOT_FOUND`, registration's shape with its flag off. Not
   * behind `FEATURE_USER_REGISTRATION`: that flag decides whether a sign-in
   * may *create* an account, which is the service's question, and an
   * existing account signs in through Google whatever it says.
   */
  const federated = container.controllers.federated;

  if (federated !== undefined) {
    router.use(
      "/auth/google",
      createFederatedRouter({
        controller: federated,
        startRateLimiter: container.rateLimiters.federatedStart,
        callbackRateLimiter: container.rateLimiters.federatedCallback,
      }),
    );
  }

  /*
   * `/invitations/lookup` (ADR-0071 §5).
   *
   * Public for the reason the two verification endpoints are: the person
   * holding the link has no account yet, which is the case the flow exists
   * for. Unconditional, too — an invitation can be created with
   * `FEATURE_USER_REGISTRATION` off, and a deployment that closed sign-ups
   * after one was sent must not turn the link in somebody's mailbox into a
   * `404`. The token is what stands in for a guard, and the limiter is
   * ADR-0067 §5's own condition on a read scoped by nothing else.
   */
  router.use(
    "/invitations",
    createPublicInvitationsRouter({
      controller: container.controllers.publicInvitations,
      rateLimiter: container.rateLimiters.invitationLookup,
    }),
  );

  return router;
};
