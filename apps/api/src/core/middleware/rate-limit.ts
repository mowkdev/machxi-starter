import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";

import type { AppConfig } from "../config/index.js";
import { rateLimited } from "../errors/index.js";
import type { RateLimitStore } from "../rate-limit/index.js";

/**
 * Rate limiting (ADR-0020 §Rate limiting).
 *
 * Nine limiters and one failure shape: the global one on `/api`, a strict one
 * on login and registration, one on *failed* refreshes, one on the
 * impersonation mint since `D13.4` — the only one keyed on a principal rather
 * than on an address (ADR-0057 §1) — and, since `D18.2`, one each on the two
 * endpoints that mail a link to an address a stranger typed (ADR-0071 §3, §4),
 * joined at `D18.5` by the one keyed on the **mailbox alone** and at `D18.7`
 * by the one keyed on the **source alone** and by the one for routes whose
 * credential is an opaque token. `/health` is deliberately outside all of them
 * — a probe that gets rate-limited takes a healthy instance out of rotation
 * (ADR-0016).
 *
 * **The window is decided by what is rationed, not by where a factory sits.**
 * Everything that bounds an attacker's *attempts* takes
 * {@link RATE_LIMIT_WINDOW_MS} — the global, login, refresh and impersonation
 * limiters, and the token-route one below. The three that ration a victim's
 * *inbox* take `RATE_LIMIT_PASSWORD_RESET_WINDOW`, because ADR-0071 §4 decides
 * that budget is per hour.
 *
 * Those three are three **keys**, not three numbers to reconcile: the address
 * with the source, the address alone, and the source alone. Each answers a
 * question the others cannot, which is why they are mounted together rather
 * than the largest of them replacing the rest.
 *
 * The store is a **parameter** since `D14.6` (ADR-0066 §4, a delta on
 * ADR-0020): `undefined` selects `express-rate-limit`'s in-memory default,
 * which counts per process, and a `Store` — Redis, when `REDIS_URL` is set —
 * makes one budget out of N instances. The *choice* is made once in
 * `core/rate-limit` and applied to every factory from the composition root,
 * because a per-limiter choice is a choice one limiter can be left out of —
 * but each limiter is handed its **own** store instance under its own key
 * prefix, because several of them key on the same thing and would otherwise
 * share a counter.
 *
 * **No limit, window or key changed with it.** ADR-0020's `300 / 15 min / IP`,
 * `10 / 15 min / IP + email` and `5 / 15 min / IP` on failed refreshes,
 * ADR-0057 §1's per-staff-principal mint budget and ADR-0071 §4's `3 / hour /
 * IP + email`, `5 / hour / email` and `20 / hour / IP` are exactly as decided;
 * only where the counter lives is configurable.
 */

/** The window every limit in ADR-0020 is expressed over. */
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/** Longest email accepted into a rate-limit key (RFC 5321). */
const MAX_KEY_EMAIL_LENGTH = 254;

/**
 * Seconds until the client's counter resets.
 *
 * `resetTime` is what the store actually knows; the window is only a fallback
 * for a store that does not report one. Rounded up, so a client that obeys it
 * is never told to retry a moment too early.
 */
const retryAfterSeconds = (req: Request, windowMs: number): number => {
  // `express-rate-limit` attaches `rateLimit` to the request but ships no
  // Express augmentation for it, so the shape is stated here rather than
  // assumed. Optional throughout: a custom store need not report a reset time.
  const { rateLimit: info } = req as Request & {
    rateLimit?: { resetTime?: Date };
  };
  const resetTime = info?.resetTime;

  const ms =
    resetTime === undefined ? windowMs : resetTime.getTime() - Date.now();

  return Math.max(1, Math.ceil(ms / 1000));
};

/**
 * Shared options: the `RATE_LIMITED` envelope, `Retry-After`, and the
 * `RateLimit-*` headers in their standardised (draft-8) form.
 *
 * The failure goes through `next(...)` rather than a response written here —
 * the error middleware is the only writer of an error body (ADR-0013), so a
 * 429 has the same shape, the same `requestId` and the same log line as every
 * other failure.
 */
/**
 * The client address, as the context middleware validated it.
 *
 * Not `req.ip` directly: behind a proxy that value can be an arbitrary string
 * (see `context.ts`), and an unbounded attacker-chosen string is a poor key for
 * an in-memory store. `ipKeyGenerator` then groups IPv6 addresses by /64, so
 * one client cannot rotate through its own subnet for a fresh budget.
 */
const ipKey = (req: Request): string => ipKeyGenerator(req.ctx.ip ?? "");

const baseOptions = (windowMs: number, store: RateLimitStore) =>
  ({
    windowMs,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: ipKey,
    // `undefined` is not the same as absent to a spread, so the key is only
    // written when there is a store: `{ store: undefined }` would override
    // `express-rate-limit`'s own default with nothing.
    ...(store === undefined ? {} : { store }),
    /**
     * **Fail closed** (ADR-0066 §4). The library's default, stated here
     * because it is a decision rather than an accident: a configured Redis
     * that cannot be reached must refuse requests, not admit every one of
     * them. The refusal goes through the error handler like any other, so the
     * store's error is logged with the request id that hit it.
     */
    passOnStoreError: false,
    handler: (req: Request, res: Response, next: NextFunction) => {
      const seconds = retryAfterSeconds(req, windowMs);

      res.setHeader("Retry-After", String(seconds));
      next(rateLimited(seconds));
    },
  }) as const;

/**
 * `RATE_LIMIT_GLOBAL_MAX / 15 min / IP` across `/api` — 300 by default
 * (ADR-0020), and more in the committed development profile, where this
 * repository's own browser tier and Postman collection are legitimate
 * consumers of a whole window (ADR-0069).
 *
 * A backstop against a client hammering any endpoint, not a substitute for the
 * strict limits below: 300 requests of *login* would already be far too many.
 */
export const createGlobalRateLimiter = (
  config: AppConfig,
  store: RateLimitStore,
): RequestHandler =>
  rateLimit({
    ...baseOptions(RATE_LIMIT_WINDOW_MS, store),
    limit: config.rateLimit.globalMax,
  });

/**
 * `10 / 15 min / IP + email` on login and registration (ADR-0020).
 *
 * Keyed on both, so one address behind a shared NAT cannot lock out everyone
 * else there, and a single IP cannot walk a password list across many
 * addresses without also tripping the global limit.
 *
 * This is a **liveness** control as much as an anti-brute-force one: every
 * request it admits costs an argon2 hash, which holds a libuv thread and
 * 64 MiB for ~130 ms (ADR-0020 §Hashing cost vs. liveness).
 */
export const createLoginRateLimiter = (
  config: AppConfig,
  store: RateLimitStore,
): RequestHandler =>
  rateLimit({
    ...baseOptions(RATE_LIMIT_WINDOW_MS, store),
    limit: config.rateLimit.loginMax,
    keyGenerator: (req) => `${ipKey(req)}:${keyEmail(req)}`,
  });

/**
 * `5 / 15 min / IP` on **failed** refreshes (ADR-0020).
 *
 * `skipSuccessfulRequests` is the whole point: a client whose access token
 * expires every 15 minutes refreshes legitimately and must never spend its
 * budget doing so. What this bounds is guessing at opaque tokens.
 *
 * **Only a rejected token spends budget** — `401`, and nothing else. Charging
 * every non-2xx was defensible while the only way to reach this endpoint was
 * to present a token, and stopped being so with cookie transport (ADR-0029):
 * the limiter runs before `csrfGuard`, is keyed on IP alone, and a `403`
 * CSRF failure or a `400` empty body would have counted. Any web page can
 * `fetch` this endpoint five times with no cookie and no body, and on cookie
 * transport a locked-out browser has no token in JavaScript to retry with —
 * so a spent budget is not "retry later", it is the session ending at the next
 * access-token expiry.
 */
export const createRefreshRateLimiter = (
  config: AppConfig,
  store: RateLimitStore,
): RequestHandler =>
  rateLimit({
    ...baseOptions(RATE_LIMIT_WINDOW_MS, store),
    limit: config.rateLimit.refreshMax,
    skipSuccessfulRequests: true,
    requestWasSuccessful: (_req, res) => res.statusCode !== 401,
  });

/**
 * `RATE_LIMIT_IMPERSONATION_MAX / 15 min / **staff principal**` on the mint
 * (ADR-0057 §1).
 *
 * The only limiter here that is not keyed on an address, because the request
 * it bounds has no address-shaped identity worth bounding: a mint is
 * authenticated, high-value, and performed from an office whose whole support
 * desk may share one egress IP. A per-IP budget there is either so loose that
 * it bounds nothing or so tight that one operator's afternoon locks out the
 * team. The actor is the thing to budget, and ten per window is a support
 * desk's day — an account spending it is worth a look.
 *
 * Keying on the principal is also what forces this limiter to mount **after**
 * `authenticate`: `ctx.principal` does not exist before it. ADR-0057 §1 states
 * that as a named refinement of ADR-0011's rate-limit-first order rather than
 * leaving it as an exception somebody invented at a route.
 *
 * The unauthenticated fallback is the address, and it is unreachable by
 * construction — the mint sits inside the admin segment, behind
 * `authenticate("staff")` and `authorize("admin")`. It is written anyway so
 * that a future mount which got the order wrong degrades to a per-IP limit
 * rather than to one shared bucket for every anonymous caller, which would be
 * a limiter that stops the whole world at ten.
 */
export const createImpersonationRateLimiter = (
  config: AppConfig,
  store: RateLimitStore,
): RequestHandler =>
  rateLimit({
    ...baseOptions(RATE_LIMIT_WINDOW_MS, store),
    limit: config.rateLimit.impersonationMax,
    keyGenerator: (req) => {
      const { principal } = req.ctx;

      return principal === null
        ? `anon:${ipKey(req)}`
        : `${principal.kind}:${principal.id}`;
    },
  });

/**
 * `RATE_LIMIT_PASSWORD_RESET_MAX / RATE_LIMIT_PASSWORD_RESET_WINDOW / IP +
 * email` on `forgot`, both segments — `3 / hour` by default (ADR-0020's
 * reserved row, spent by ADR-0071 §4).
 *
 * **The only limiter here with a window of its own**, and the reason is the
 * thing being rationed. Every limit above bounds an attacker's attempts, so
 * fifteen minutes is a sensible unit; this one bounds *messages sent to a
 * stranger's mailbox*, where the cost falls on the victim rather than on the
 * caller. Three an hour is generous against the honest case — nobody
 * legitimately asks for a fourth reset link having been sent three — and it is
 * what stops the endpoint being a free mail cannon aimed at one address.
 *
 * Keyed on address **and** email, like login and for the same reason: one
 * mailbox behind a shared NAT must not spend everybody else's budget. Reading
 * the body before `validate` is deliberate and is what {@link keyEmail}
 * documents — a request refused by a schema must still count, or an attacker
 * gets an unlimited budget by sending one that fails.
 */
export const createPasswordResetRateLimiter = (
  config: AppConfig,
  store: RateLimitStore,
): RequestHandler =>
  rateLimit({
    ...baseOptions(config.rateLimit.passwordResetWindowSec * 1000, store),
    limit: config.rateLimit.passwordResetMax,
    keyGenerator: (req) => `${ipKey(req)}:${keyEmail(req)}`,
  });

/**
 * `RATE_LIMIT_MAILBOX_MAX / RATE_LIMIT_PASSWORD_RESET_WINDOW / **email**` on
 * `forgot`, both segments — `5 / hour` by default (ADR-0071 §4, amended at
 * `D18.5` on the operator's decision).
 *
 * **The only limiter here with no source address in its key**, and that is the
 * whole point of it. Every other one — the global limiter included — keys on
 * the caller's address, so all of them vary together with the one thing an
 * attacker can change most cheaply: a proxy pool, a botnet, or an IPv6 client
 * with a `/64` to walk turns `3 / hour / IP + email` into `3 × N`, and the
 * ceiling nobody had is the mailbox's own. This is that ceiling. The pair now
 * says one sentence: a mailbox receives at most this many of these messages an
 * hour from everybody, and at most `RATE_LIMIT_PASSWORD_RESET_MAX` of them
 * from any one source.
 *
 * **A request with no readable address falls back to the source key**, prefixed
 * so it can never collide with a real address. Keying every such request on the
 * empty string would put them all in one bucket, and five malformed bodies an
 * hour from anybody would then refuse `forgot` to the whole world — the
 * failure `createImpersonationRateLimiter`'s own fallback avoids, for the same
 * reason. `validate` rejects those requests a moment later; the limiter runs
 * first, so it has to answer for them.
 *
 * What it does **not** bound is one sender walking a list of *distinct*
 * addresses: this key varies with the address and so does the pair's other
 * half. That is {@link createMailSourceRateLimiter}'s question, taken at
 * `D18.7` on the operator's decision and mounted beside this one rather than
 * in place of it.
 */
export const createMailboxRateLimiter = (
  config: AppConfig,
  store: RateLimitStore,
  {
    recipientField = "email",
    subjectParam,
    skipFailedRequests = false,
  }: MailboxRateLimiterOptions = {},
): RequestHandler =>
  rateLimit({
    ...baseOptions(config.rateLimit.passwordResetWindowSec * 1000, store),
    limit: config.rateLimit.mailboxMax,
    skipFailedRequests,
    keyGenerator: (req) => {
      const subject =
        subjectParam === undefined ? "" : keyParam(req, subjectParam);

      if (subject !== "") return `subject:${subject}`;

      const email = keyEmail(req, recipientField);

      return email === "" ? `anon:${ipKey(req)}` : email;
    },
  });

/** {@link createMailboxRateLimiter}'s per-mount choices. */
export interface MailboxRateLimiterOptions {
  /**
   * Which field of the body names the mailbox this budget is spent on.
   *
   * `email` for every sender up to `D18.7` — `forgot` on both segments and an
   * organization's invitation. `D18.9` added the first body that spells it
   * differently: `POST /user/profile/change-email` names the recipient
   * `newEmail`, because the address it carries is the one the account is
   * moving **to** (ADR-0071 §6).
   *
   * Named at the mount rather than guessed by trying both, and that is the
   * decision rather than a style: this limiter runs above `validate`, so a
   * reader that fell back to a second field would let a caller on *any* of
   * these routes hand every request a key of its own by inventing the field
   * the schema does not have — the exact hole `D18.7`'s `security-reviewer`
   * found in the login limiter's key and the reason
   * {@link createTokenRouteRateLimiter} exists.
   */
  readonly recipientField?: "email" | "newEmail";
  /**
   * Key on a **path parameter** naming the subject, rather than on a field of
   * the body (`D18.11`, ADR-0071 §8).
   *
   * The one sender whose recipient is nowhere in the request:
   * `POST /admin/staff/:id/onboarding/resend` mails the address **on the
   * row**, which is what stops a caller redirecting it — and also what leaves
   * this limiter with no address to read. The subject's id stands in for that
   * mailbox one-for-one and, unlike a body field, it is matched by the route
   * rather than supplied by the caller, so there is nothing here for an
   * inventive body to vary. It is prefixed rather than used bare, so an id can
   * never collide with an address in a shared store.
   *
   * It takes precedence over {@link recipientField} when both are set, which
   * no mount does; a request whose parameter is missing falls back to the
   * per-source key exactly as a missing address does.
   */
  readonly subjectParam?: string;
  /**
   * Whether a refused request keeps its share of the budget.
   *
   * `false` everywhere §4 decided it, and the reason is §4's own: `forgot` and
   * the invitation answer the same thing to nearly everything they are handed,
   * so "a budget an invalid body escapes is not a budget".
   *
   * `true` on `change-email` alone, and it is a different endpoint rather than
   * a softer rule (`D18.9`'s `code-reviewer`). That route demands a credential
   * and can refuse for reasons that mail nothing at all — a wrong current
   * password above all — while this limiter runs above both the schema and the
   * credential check. Counting those would mean five mistyped passwords lock a
   * person out of moving to that address for the rest of the hour, which is
   * the budget denying the mailbox it exists to protect. What is rationed here
   * is messages, and only a `202` sends one.
   */
  readonly skipFailedRequests?: boolean;
}

/**
 * `RATE_LIMIT_MAIL_SOURCE_MAX / RATE_LIMIT_PASSWORD_RESET_WINDOW / **IP**`,
 * shared by every unauthenticated endpoint that mails an address a caller
 * typed — `forgot` on both segments, `resend-verification` and `register`
 * (ADR-0071 §4, amended at `D18.7` on the operator's decision).
 *
 * The third key, and the one the other two cannot supply. Both of them carry
 * the *address* the request names, so both reset the moment it changes: one
 * source naming three hundred strangers in turn gets three hundred fresh
 * buckets from each, and the only thing left standing is ADR-0020's global
 * limiter — which this repository's own development profile deliberately
 * raises (ADR-0069). This key stays put while the address varies, which is
 * exactly the walk it exists to ceiling.
 *
 * **One counter across all of those routes**, handed the same instance from
 * the composition root. A limiter per endpoint would be three budgets for one
 * source to spend in turn, and what is rationed here is this deployment's
 * outbound mail to strangers rather than any one route. Registration is on it
 * because it mails a link to an address the caller typed, which is the same
 * walk under a different verb.
 *
 * **Its number is a capacity number**, unlike the two beside it, and ADR-0071
 * §4 says so where it takes the limiter: the key is a source address, which
 * behind a carrier-grade NAT or a corporate egress is a great many people, so
 * the default is safe rather than measured and a deployment sizes it against
 * its own traffic (`docs/deploy.md`). What it costs is stated there too — a
 * source that spends it reaches no mail flow at all until the window turns,
 * which behind a shared egress is everybody there.
 *
 * No body is read, so there is no "the caller named no address" branch to
 * write — but "no fallback" would be too strong (`D18.7`'s `code-reviewer`).
 * {@link ipKey} answers `""` for a request whose client address the context
 * middleware refused to accept as an address at all, and every such request
 * then shares one bucket. That is a property of `ipKey` rather than of this
 * limiter — the global and refresh limiters have carried it since ADR-0020 —
 * and reaching it takes a `TRUST_PROXY` set one hop too many together with a
 * client sending a forwarded header that is not an address. It is written down
 * here rather than papered over in one of the nine limiters that share it.
 */
export const createMailSourceRateLimiter = (
  config: AppConfig,
  store: RateLimitStore,
): RequestHandler =>
  rateLimit({
    ...baseOptions(config.rateLimit.passwordResetWindowSec * 1000, store),
    limit: config.rateLimit.mailSourceMax,
  });

/**
 * ADR-0020's login numbers over the shared window, keyed on the **source
 * alone** — for the routes whose credential is an opaque token in the body and
 * which therefore carry no address to key on (`D18.7`'s `security-reviewer`).
 *
 * It exists because `createLoginRateLimiter` is the wrong instrument for them.
 * That limiter keys on `IP + `{@link keyEmail}`, read from the **unvalidated**
 * body — which is right on `login`, where `email` is a field of the schema and
 * varying it buys an attacker nothing. On a route whose schema has no `email`
 * the same key is attacker-controlled at no cost: `{ token, email: "1" }`,
 * `{ token, email: "2" }` and so on each open a bucket of their own.
 *
 * **What that actually costs is worth stating precisely, because it is less
 * than it first looks** (`D18.7`'s `code-reviewer` against `D18.7`'s
 * `security-reviewer`). Both bodies are `z.strictObject`, so a request
 * carrying an invented field is refused by `validate` and never reaches the
 * argon2 hash or the token lookup the budget is really protecting — and every
 * *well-formed* request keys identically, so the budget on the work itself was
 * never escapable. What was escapable is the counting of the refused ones,
 * which is exactly what {@link keyEmail}'s own docblock says must not happen,
 * and what it leaves behind is an unbounded set of attacker-chosen keys in a
 * memory store. Both are reasons enough; "the budget existed in the docblock
 * only" was not true and is not claimed.
 *
 * So this reads no body. Two routes take it: `password/reset`, where the
 * budget is ADR-0020 §Hashing cost's argon2 liveness control, and ADR-0067
 * §5's `invitations/lookup`, where it is the "limited as an authentication
 * route is" condition that record puts on a read scoped by nothing but a
 * secret. Each takes its **own instance**, so the two counters are separate
 * for the reason `D18.5` separated the reset's from `login`'s.
 */
export const createTokenRouteRateLimiter = (
  config: AppConfig,
  store: RateLimitStore,
): RequestHandler =>
  rateLimit({
    ...baseOptions(RATE_LIMIT_WINDOW_MS, store),
    limit: config.rateLimit.loginMax,
  });

/**
 * The same budget on `resend-verification` (ADR-0071 §3), in a **counter of
 * its own**.
 *
 * "Its own limiter" is the decision, not "its own number": the two endpoints
 * ration the identical resource — a message this deployment sends to an
 * address somebody typed — so a second knob would be two ways to write one
 * policy, and ADR-0071 names exactly one budget. What must not be shared is
 * the *counter*: a person who is legitimately stuck on verification would
 * otherwise spend the recovery budget for the same mailbox, and be unable to
 * reset the password they came to reset.
 *
 * The separation is real only because the composition root hands every limiter
 * its own store instance under its own prefix (ADR-0066 §4); building this one
 * beside a route would give each mount a fresh budget instead.
 */
export const createVerificationRateLimiter = (
  config: AppConfig,
  store: RateLimitStore,
): RequestHandler =>
  rateLimit({
    ...baseOptions(config.rateLimit.passwordResetWindowSec * 1000, store),
    limit: config.rateLimit.passwordResetMax,
    keyGenerator: (req) => `${ipKey(req)}:${keyEmail(req)}`,
  });

/**
 * The email from a login body, normalised for use in a key.
 *
 * This reads `req.body` directly, which no controller may do (ADR-0011) — the
 * limiter runs *before* `validate`, by design: a request that is rejected by a
 * schema must still count against the limit, or an attacker gets unlimited
 * attempts by sending a body that fails validation. It is bounded and
 * lower-cased here because an unbounded value from an unvalidated body would
 * otherwise become a memory-store key.
 */
/**
 * A path parameter, bounded, for the one mailbox key that is not an address
 * (`D18.11`).
 *
 * Bounded for {@link keyEmail}'s reason and then some: this runs above
 * `validate`, so the value is whatever matched the route's pattern and has not
 * yet been proven to be a uuid. An unbounded one would become a memory-store
 * key.
 */
const keyParam = (req: Request, name: string): string => {
  const value: unknown = req.params[name];

  return typeof value === "string"
    ? value.trim().toLowerCase().slice(0, MAX_KEY_EMAIL_LENGTH)
    : "";
};

const keyEmail = (
  req: Request,
  field: "email" | "newEmail" = "email",
): string => {
  const body: unknown = req.body;
  const email =
    typeof body === "object" && body !== null && field in body
      ? (body as Record<string, unknown>)[field]
      : undefined;

  return typeof email === "string"
    ? email.trim().toLowerCase().slice(0, MAX_KEY_EMAIL_LENGTH)
    : "";
};
