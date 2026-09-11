import type { Population } from "@repo/contracts";
import { Router, type RequestHandler } from "express";

import type { CookieNames } from "../../core/http/index.js";

import {
  createCsrfGuard,
  noStore,
  validate,
} from "../../core/middleware/index.js";
import type { AuthController } from "./auth.controller.js";
import type { FederatedController } from "./auth.federated.controller.js";
import {
  federatedCallbackSchema,
  federatedExchangeSchema,
  federatedStartSchema,
} from "./auth.federated.schemas.js";
import type { ImpersonationController } from "./auth.impersonation.controller.js";
import { exchangeImpersonationSchema } from "./auth.impersonation.schemas.js";
import {
  acceptOnboardingSchema,
  confirmEmailSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "./auth.schemas.js";

/**
 * `/api/v1/{admin,user}/auth/*` and `/api/v1/public/auth/register`
 * (ADR-0015, ADR-0018).
 *
 * One router factory serves both populations: the segment decides which
 * service is behind it and which population `authenticate` pins the token to,
 * and nothing about the URLs or the order below differs between them.
 *
 * The per-route order is the one ADR-0011 fixes:
 * `rateLimit → authenticate → authorize → validate → controller`. There is no
 * `authorize` here — being authenticated *is* the requirement for reading your
 * own principal or ending your own session.
 */

export interface AuthRouterDeps {
  readonly controller: AuthController;
  /**
   * This deployment's cookie names, for the three CSRF guards below
   * (ADR-0064 §1). The container builds one bundle, and the controller these
   * routes call writes with the same one.
   */
  readonly cookieNames: CookieNames;
  /** `authenticate(population)` from the container (ADR-0011). */
  readonly authenticate: (population: Population) => RequestHandler;
  readonly population: Population;
  readonly loginRateLimiter: RequestHandler;
  readonly refreshRateLimiter: RequestHandler;
  /**
   * ADR-0071 §4's `3 / hour / IP + email` on `password/forgot` — what one
   * sender may mail one mailbox.
   */
  readonly passwordResetRateLimiter: RequestHandler;
  /**
   * Its other half, keyed on the **mailbox alone** (§4, amended at `D18.5`) —
   * what that mailbox receives from everybody. Both are mounted, in that
   * order, because they answer two different questions and neither implies
   * the other.
   */
  readonly mailboxRateLimiter: RequestHandler;
  /**
   * The third of §4's keys, keyed on the **source alone** (§4, amended at
   * `D18.7`) — what one source may mail in total, however many addresses it
   * names. One instance for every unauthenticated sender in the API, so this
   * route shares its counter with `register` and `resend-verification`.
   */
  readonly mailSourceRateLimiter: RequestHandler;
  /**
   * The argon2 budget on `password/reset` — the login limiter's numbers in a
   * counter of its own, because the reset's body carries no address and would
   * otherwise share the bucket every malformed `login` lands in.
   */
  readonly passwordResetSubmitRateLimiter: RequestHandler;
  /**
   * The same argon2 budget on `onboarding/accept` (ADR-0071 §8), and a
   * counter of its own for `passwordResetSubmit`'s reason: this body carries
   * no address either, so its key is the caller's — the key a malformed
   * `login` produces — and one shared instance would let sign-in noise from
   * an office refuse a new colleague the one link they have.
   *
   * Passed to both mounts and registered by only one, exactly as
   * {@link AuthRouterDeps.impersonation} is: the condition lives beside the
   * route it guards.
   */
  readonly onboardingAcceptRateLimiter: RequestHandler;
  /**
   * The exchange half of the impersonation flow (ADR-0057 §3).
   *
   * Passed to both mounts and registered by only one — see the route below.
   * It is a dependency of the factory rather than of the segment router so
   * that the `population === "user"` condition lives beside the route it
   * guards, where a reader can see it.
   */
  readonly impersonation: Pick<ImpersonationController, "exchange">;
  /**
   * ADR-0057 §5's exclusion guard, mounted on `logout-all` (ADR-0019).
   *
   * Passed to both segments and refusing on neither unless the principal
   * carries an actor, which only a customer's can: the staff mount is a no-op
   * by construction rather than by a condition someone has to maintain.
   */
  readonly refuseImpersonated: RequestHandler;
}

export const createAuthRouter = ({
  controller,
  cookieNames,
  authenticate,
  population,
  loginRateLimiter,
  refreshRateLimiter,
  passwordResetRateLimiter,
  mailboxRateLimiter,
  mailSourceRateLimiter,
  passwordResetSubmitRateLimiter,
  onboardingAcceptRateLimiter,
  impersonation,
  refuseImpersonated,
}: AuthRouterDeps): Router => {
  const router = Router();

  // Every response here either carries a credential or describes who holds
  // one. A cached `/auth/me` or a token response kept by a shared proxy is a
  // session leak, and `no-store` is the only directive that also forbids
  // writing it to disk (ADR-0020).
  router.use(noStore);

  // Unauthenticated by definition: these are how a client *gets* a token.
  //
  // `/csrf` is first because it is what a reloaded browser calls before it can
  // call anything else (ADR-0030). It carries no limiter of its own: the
  // global one (ADR-0020) covers it, and it deliberately does **not** take
  // `refreshRateLimiter` — that budget is for guessing at opaque tokens, and a
  // bootstrap presents nothing to guess. Charging it there would let any page
  // spend a visitor's refresh budget by calling this endpoint.
  router.get("/csrf", controller.csrf);
  router.post(
    "/login",
    loginRateLimiter,
    validate(loginSchema),
    controller.login,
  );
  // `csrfGuard` before `validate`, and that is the ADR-0011 order rather than
  // an exception to it: it is a guard, and a request that fails it should not
  // first have its body parsed to produce a better error message. It does
  // nothing at all unless the request is leaning on the refresh cookie
  // (ADR-0029 §CSRF), so every `body`-transport caller passes straight through.
  router.post(
    "/refresh",
    refreshRateLimiter,
    // The one endpoint where a token in the body is a legitimate way to
    // present the credential, and therefore the only one where it exempts the
    // request from the check (ADR-0029 §CSRF).
    createCsrfGuard({
      cookies: cookieNames,
      population,
      allowBodyToken: true,
    }),
    validate(refreshSchema),
    controller.refresh,
  );

  /*
   * Password recovery, both segments (ADR-0071 §4).
   *
   * Unauthenticated and mounted **above** `authenticate`, beside `login`, for
   * the reason `login` is here: these are how somebody who cannot sign in gets
   * back in, so a guard on them would be a guard on the recovery itself.
   *
   * **Neither carries a CSRF guard**, and that is the decision `login` makes
   * rather than an oversight (ADR-0029 §CSRF): the request leans on nothing in
   * the browser's jar — the address or the token in the body is the whole
   * input — so there is no cross-site submission whose intent needs proving.
   * Mounting one would also refuse a signed-in browser's perfectly ordinary "I
   * forgot my password", because the guard fires on the presence of the
   * refresh cookie rather than on the endpoint's use of it.
   *
   * `forgot` carries **three** limiters and the set is the decision (§4,
   * amended at `D18.5` and again at `D18.7`): what one sender may mail one
   * mailbox, what that mailbox receives from everybody, and what one sender
   * may mail in total however many addresses it names. Three keys and three
   * questions — the first two both carry the address the request names, so
   * both reset when it changes and neither can see a walk across strangers.
   * The third shares its counter with `register` and `resend-verification`,
   * because what it rations is this deployment's outbound mail rather than
   * this route.
   *
   * `reset` carries the **login limiter's numbers in a counter of its own**,
   * for the reason `register` shares that limiter (ADR-0020 §Hashing cost vs.
   * liveness): the request hashes a password before it can know whether the
   * token is any good, and every request admitted here holds a libuv thread
   * and 64 MiB for ~130 ms. It is not the mail budget's business — nothing is
   * sent. The counter is its own because this body carries no address, so the
   * key degrades to the caller's, which is exactly the key a `login` with no
   * readable address produces: one shared instance would let ten malformed
   * sign-in attempts from an IP block reset *completion* for everybody behind
   * it (`D18.5`'s `security-reviewer`).
   */
  router.post(
    "/password/forgot",
    passwordResetRateLimiter,
    mailboxRateLimiter,
    mailSourceRateLimiter,
    validate(forgotPasswordSchema),
    controller.forgotPassword,
  );
  router.post(
    "/password/reset",
    passwordResetSubmitRateLimiter,
    validate(resetPasswordSchema),
    controller.resetPassword,
  );

  /*
   * `POST /onboarding/accept` (ADR-0071 §8), unauthenticated for the reason
   * `password/reset` is: the token in the body is the credential, and an
   * `invited` operator has no session and no password to get one with.
   *
   * **Only on the `staff` segment**, which is the mirror of the condition
   * `/impersonate` carries below and refuses the mirror mistake. This factory
   * is mounted once per segment, so an unconditional registration would create
   * a user-segment twin — a second endpoint able to spend a
   * `staff_onboarding` token, on a population whose adapter has no
   * `activateOnboarded` to serve it. The condition is what keeps that a
   * compile-time absence rather than a `500` somebody has to find.
   *
   * **No CSRF guard**, for the reason `login` and the recovery pair carry
   * none (ADR-0029 §CSRF): the request leans on nothing in the browser's jar,
   * so there is no cross-site submission whose intent needs proving. It does
   * carry the argon2 budget, because it hashes a password before it can know
   * whether the token is any good (ADR-0020 §Hashing cost vs. liveness) —
   * `password/reset`'s reasoning, on the route that is its twin.
   */
  if (population === "staff") {
    router.post(
      "/onboarding/accept",
      onboardingAcceptRateLimiter,
      validate(acceptOnboardingSchema),
      controller.acceptOnboarding,
    );
  }

  // The exchange (ADR-0057 §3), unauthenticated like `login` and for the same
  // reason: the handoff token is the credential, and a client that had a
  // session would not need one.
  //
  // **Only on the `user` segment.** This factory is mounted once per segment,
  // so an unconditional registration would create an admin-segment twin — a
  // way to turn a URL fragment into a staff session, which is exactly what the
  // whole handoff design refuses to allow. The condition is the guard.
  //
  // No CSRF guard, for the reason `login` carries none: the request leans on
  // no cookie at all — nothing in the browser's jar authorises it — so there
  // is no cross-site submission to prove intent for. It carries no limiter of
  // its own either: the mint is where a budget belongs (ADR-0057 §1), the
  // token here is 32 random bytes with a 60-second life, and the global
  // limiter covers the endpoint.
  if (population === "user") {
    router.post(
      "/impersonate",
      validate(exchangeImpersonationSchema),
      impersonation.exchange,
    );
  }

  // Everything registered below this line requires a principal of this
  // population. Mounting the guard once, here, is what makes a future endpoint
  // protected by where it sits rather than by somebody remembering to add a
  // decorator (ADR-0019 §1).
  router.use(authenticate(population));

  // Both carry the guard for the same reason `refresh` does: a browser on
  // cookie transport sends the refresh cookie here too — the path matches —
  // and ending somebody's session from another site is a smaller prize than
  // stealing it but still not one to hand over.
  //
  // `population` reaches the guard the same way it reaches `authenticate`
  // above: this factory is mounted once per segment, so the segment is what
  // decides which CSRF cookie is checked (ADR-0056).
  router.post(
    "/logout",
    createCsrfGuard({ cookies: cookieNames, population }),
    controller.logout,
  );
  // `logout-all` is on ADR-0057 §5's exclusion list and `logout` deliberately
  // is not: one ends the **customer's** real sessions on every device they own,
  // which is a takeover step and not support work, and the other is the
  // impersonation banner's own exit control. The guard sits after the CSRF
  // check and before the controller, so a refusal costs one comparison and
  // reaches no service.
  router.post(
    "/logout-all",
    createCsrfGuard({ cookies: cookieNames, population }),
    refuseImpersonated,
    controller.logoutAll,
  );
  router.get("/me", controller.me);

  return router;
};

export interface RegisterRouterDeps {
  readonly controller: AuthController;
  /** The login limiter: registration hashes a password and creates a session too. */
  readonly rateLimiter: RequestHandler;
  /**
   * §4's source-keyed budget (amended at `D18.7`), shared with `forgot` and
   * `resend-verification`.
   *
   * Registration is on it because it **mails a link to an address the caller
   * typed**, which is the same walk across strangers' mailboxes that
   * `forgot` is, under a different verb: the login limiter above keys on
   * `IP + email` and so resets on every new address, exactly as §4's other
   * two keys do.
   */
  readonly mailSourceRateLimiter: RequestHandler;
}

/**
 * `POST /api/v1/public/auth/register` (ADR-0018 §Staff onboarding).
 *
 * A separate router because it belongs to a different segment: it is the one
 * auth endpoint that is genuinely public, and it exists only for `users` —
 * staff are created by an admin. The container mounts it only when
 * `FEATURE_USER_REGISTRATION` is on (ADR-0004), so with the flag off the path
 * answers `ROUTE_NOT_FOUND` rather than a `403` that would confirm the feature
 * exists.
 */
export const createRegisterRouter = ({
  controller,
  rateLimiter,
  mailSourceRateLimiter,
}: RegisterRouterDeps): Router => {
  const router = Router();

  router.use(noStore);
  router.post(
    "/register",
    rateLimiter,
    mailSourceRateLimiter,
    validate(registerSchema),
    controller.register,
  );

  return router;
};

export interface VerificationRouterDeps {
  readonly controller: AuthController;
  /**
   * ADR-0071 §4's budget in its own counter (`3 / hour / IP + email`), built
   * at the composition root so one instance holds one count.
   */
  readonly rateLimiter: RequestHandler;
  /**
   * §4's source-keyed budget (amended at `D18.7`), on `resend-verification`
   * alone: `verify-email` sends nothing and spends a credential the caller
   * already holds.
   */
  readonly mailSourceRateLimiter: RequestHandler;
}

/**
 * `POST /api/v1/public/auth/{verify-email,resend-verification}`
 * (ADR-0071 §3).
 *
 * A router of its own rather than two more routes on {@link
 * createRegisterRouter}, and the split is the decision: that one is mounted
 * only when `FEATURE_USER_REGISTRATION` is on, and these two must not be. An
 * address can reach `pending_verification` without self-registration — a staff
 * member may create an account in that state — and a deployment that switches
 * registration off after a person has signed up must not turn the link in
 * their mailbox into a `404`. It is also where §6's `confirm-email` lands.
 *
 * **Neither route carries a CSRF guard**, for the reason `login` carries none
 * (ADR-0029 §CSRF): the request leans on no cookie — nothing in the browser's
 * jar authorises it — so there is no cross-site submission to prove intent
 * for. The token *is* the credential.
 *
 * `verify-email` carries no limiter of its own either, exactly as
 * `/impersonate` does not (ADR-0057 §3): the credential is 32 random bytes
 * with a day to live, the mint is where a budget belongs, and the global
 * limiter covers the endpoint. `resend-verification` does carry one, because
 * what it spends is a stranger's inbox rather than an attacker's patience.
 */
export const createVerificationRouter = ({
  controller,
  rateLimiter,
  mailSourceRateLimiter,
}: VerificationRouterDeps): Router => {
  const router = Router();

  // The verify response carries a session (ADR-0071 §3), so it is under the
  // same directive every other credential-bearing response is (ADR-0020).
  router.use(noStore);

  router.post(
    "/verify-email",
    validate(verifyEmailSchema),
    controller.verifyEmail,
  );
  router.post(
    "/resend-verification",
    rateLimiter,
    mailSourceRateLimiter,
    validate(resendVerificationSchema),
    controller.resendVerification,
  );

  /*
   * `POST /api/v1/public/auth/confirm-email` (ADR-0071 §6) — the landing this
   * router's docblock said it was waiting for.
   *
   * Here rather than beside `/user/profile/change-email`, which is where the
   * change is *asked for*: the link is followed from the new mailbox, which is
   * very often not the browser holding the session — a work address opened on
   * a phone is the ordinary case — so a route under `authenticate("user")`
   * would refuse the person the message was addressed to.
   *
   * **No limiter and no CSRF guard**, and both absences are the decisions
   * §3's amendment set down for this router rather than inheritances nobody
   * re-checked. The credential is 32 random bytes with an hour to live and the
   * consume is one indexed update, so guessing is not a rate problem and the
   * budget belongs at the mint — which is the authenticated half, behind a
   * session and a password. Nothing in the browser's jar authorises the
   * request: the token in the body *is* the credential, so there is no
   * cross-site submission whose intent needs proving, and unlike
   * `verify-email` this route does not even issue a session for a cross-site
   * page to want.
   *
   * The one item on §3's "what would change it" list this route does touch is
   * "acts on an authenticated principal" — it moves an address on a real
   * account. It acts on the account the *token* names and never on one the
   * request's own credentials identify, which is the distinction that list
   * draws: there is no ambient authority here for a CSRF guard to protect.
   */
  router.post(
    "/confirm-email",
    validate(confirmEmailSchema),
    controller.confirmEmail,
  );

  return router;
};

export interface FederatedRouterDeps {
  readonly controller: FederatedController;
  /**
   * The start's own budget (ADR-0072 §2): `RATE_LIMIT_LOGIN_MAX`'s number,
   * keyed on the source address alone, in a counter of its own — the
   * `D18.2` precedent for a second counter on one number. A start costs the
   * API a signature and Google a redirect, and there is no address yet to key
   * on.
   */
  readonly startRateLimiter: RequestHandler;
  /**
   * The callback's budget — the start's number and key in a counter of its
   * own (ADR-0072 §2, amended at `D19.2`): a sealed transaction replayed with
   * invented codes is a request to Google's token endpoint per replay.
   */
  readonly callbackRateLimiter: RequestHandler;
}

/**
 * `/api/v1/public/auth/google/{start,callback,exchange}` (ADR-0072 §2).
 *
 * Mounted by the public router **only when the Google client is configured**
 * — both halves of it — so without one the three paths answer
 * `404 ROUTE_NOT_FOUND`, exactly as registration does with its flag off
 * (ADR-0004). Nothing here checks a flag: the mount is the control.
 *
 * - **`start`** is a `POST` from the customer app's own client, never a
 *   navigation: a `GET` that redirected would be a link anyone could plant to
 *   start a flow in a victim's browser.
 * - **`callback`** is the one navigation, from Google. **No CSRF guard**, on
 *   ADR-0071 §3's reasoning as ADR-0072 §2 applies it: the `state` in the
 *   transaction cookie is the binding and the code is single-use at Google.
 *   It carries a limiter of its own since `D19.2`'s `security-reviewer`,
 *   because each callback with a valid cookie costs a request to Google.
 *   Every outcome is a `302` — but for that limiter's `429` — so its query
 *   schema cannot fail.
 * - **`exchange`** is `verify-email`'s shape but for one thing: the token in
 *   the body is the credential **and** the handoff binding the callback left
 *   in the cookie must name it, so only the browser the callback answered can
 *   spend it (amended at `D19.2`). The mint — the callback — is where a
 *   budget belongs.
 */
export const createFederatedRouter = ({
  controller,
  startRateLimiter,
  callbackRateLimiter,
}: FederatedRouterDeps): Router => {
  const router = Router();

  // The exchange answers with a session and the other two with a credential's
  // beginnings or its delivery; none of it belongs in a shared cache
  // (ADR-0020).
  router.use(noStore);

  router.post(
    "/start",
    startRateLimiter,
    validate(federatedStartSchema),
    controller.start,
  );
  router.get(
    "/callback",
    callbackRateLimiter,
    validate(federatedCallbackSchema),
    controller.callback,
  );
  router.post(
    "/exchange",
    validate(federatedExchangeSchema),
    controller.exchange,
  );

  return router;
};
