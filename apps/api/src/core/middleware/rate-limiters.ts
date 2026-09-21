import type { AppConfig } from "../config/index.js";
import type { RateLimitStoreFactory } from "../rate-limit/index.js";
import {
  createGlobalRateLimiter,
  createImpersonationRateLimiter,
  createLoginRateLimiter,
  createMailboxRateLimiter,
  createMailSourceRateLimiter,
  createPasswordResetRateLimiter,
  createPrincipalHashRateLimiter,
  createRefreshRateLimiter,
  createSetPasswordLinkRateLimiter,
  createTokenRouteRateLimiter,
  createVerificationRateLimiter,
} from "./rate-limit.js";

/**
 * Every limiter this process mounts, built once (ADR-0073 §10).
 *
 * Built **here**, not in the route factories, because a limiter holds the
 * counter: constructing one per mount would give the same IP+email a fresh
 * budget on every segment, so ADR-0020's "10 per 15 minutes on login" would
 * really be ten per login endpoint. Stateful components belong to the
 * composition root (ADR-0009), and this is why.
 *
 * It is a function of the configuration and the store factory and of nothing
 * else — no database, no service, no module — which is why ADR-0073 §10 moves
 * it out of `core/container.ts` and beside the factories it calls. The
 * composition root calls it once and hands the result to the routers.
 *
 * `store` is the **factory** taking the limiter's name, not one store: several
 * of these key on the same thing, and `rate-limit-redis` keys on
 * `prefix + key`, so one shared instance would merge their counters
 * (ADR-0066 §4). Each name below is that prefix.
 */
export const createRateLimiters = (
  config: AppConfig,
  store: RateLimitStoreFactory,
) =>
  ({
    global: createGlobalRateLimiter(config, store("global")),
    /** Shared by both segments' `login` and by `register` (ADR-0018). */
    login: createLoginRateLimiter(config, store("login")),
    refresh: createRefreshRateLimiter(config, store("refresh")),
    /**
     * The mint's own budget, and the only limiter here keyed on a principal
     * rather than an address (ADR-0057 §1). Built here for the reason all the
     * others are — one instance holds one counter — and mounted inside the
     * admin segment, after `authenticate`, because its key does not exist
     * before that.
     */
    impersonation: createImpersonationRateLimiter(
      config,
      store("impersonation"),
    ),
    /**
     * The two that ration messages rather than attempts (ADR-0071 §3, §4) —
     * `3 / hour / IP + email` each, mounted by `D18.3` and `D18.5`.
     *
     * Two instances of one budget, and the two prefixes are the decision: a
     * person stuck on verification must not spend the recovery budget for the
     * same mailbox and find themselves unable to reset the password they came
     * to reset.
     */
    passwordReset: createPasswordResetRateLimiter(
      config,
      store("password-reset"),
    ),
    verification: createVerificationRateLimiter(config, store("verification")),
    /**
     * The third of them, and the only limiter in the container with no source
     * address in its key (ADR-0071 §4, amended at `D18.5`).
     *
     * Mounted **beside** `passwordReset` on both segments' `forgot` rather
     * than instead of it: the pair is the decision. That one bounds what a
     * single sender may mail one mailbox; this one bounds what the mailbox
     * receives from everybody, which nothing did — every other limiter here,
     * the global one included, keys on the caller's address and so varies with
     * the cheapest thing an attacker can change.
     */
    mailbox: createMailboxRateLimiter(config, store("mailbox")),
    /**
     * The third of §4's keys and the only one that does not move when the
     * address does (ADR-0071 §4, amended at `D18.7` on the operator's
     * decision).
     *
     * **One instance, mounted on every unauthenticated endpoint that mails an
     * address a caller typed** — both segments' `forgot`, `resend-verification`
     * and `register`. The sharing is the decision: the pair above bounds what
     * one source may mail *one* mailbox and what one mailbox receives from
     * everybody, and neither can see one source walking a list of strangers,
     * because both keys vary with the address the request names. A counter per
     * endpoint would be three budgets for that walk to spend in turn.
     */
    mailSource: createMailSourceRateLimiter(config, store("mail-source")),
    /**
     * The argon2 budget on `password/reset` — the login limiter's numbers in a
     * **counter of its own** (`D18.5`'s `security-reviewer`).
     *
     * The route hashes a password before it can know whether the token is any
     * good, so it needs the liveness control ADR-0020 §Hashing cost describes
     * and `register` already shares. What it must not share is the count:
     * `resetPasswordBody` carries no `email`, so one instance would let ten
     * malformed `POST /login` bodies from an IP block password-reset
     * **completion** for everybody behind it, which is a denial of the one
     * flow a person reaches when nothing else works.
     *
     * **`createTokenRouteRateLimiter`, not `createLoginRateLimiter`**
     * (`D18.7`'s `security-reviewer`, correcting `D18.5`). This body has no
     * `email` *field*, but the limiter runs above `validate` and would read
     * one out of it anyway — so a caller could hand every request a fresh key
     * by inventing the field, and the budget would exist in the docblock only.
     * The replacement reads no body at all.
     */
    passwordResetSubmit: createTokenRouteRateLimiter(
      config,
      store("password-reset-submit"),
    ),
    /**
     * The start of a sign-in with Google (ADR-0072 §2): the login limiter's
     * number, keyed on the source address alone, in a **counter of its own**
     * — the `D18.2` precedent for a second counter on one number.
     *
     * `createTokenRouteRateLimiter` for the reason `passwordResetSubmit` takes
     * it: there is no address in this body to key on — the person is not
     * known until Google says who they are — and a factory that read one
     * would let a caller mint a fresh key per request by inventing the field.
     * Its own instance, so starting a sign-in never spends the budget a
     * password login from the same office needs, or the other way round.
     */
    federatedStart: createTokenRouteRateLimiter(
      config,
      store("federated-start"),
    ),
    /**
     * The callback's budget (ADR-0072 §2, amended at `D19.2` on that step's
     * `security-reviewer`): the same number and key as the start's, in a
     * counter of its own.
     *
     * The transaction cookie is single-use only in an honest browser — the
     * sealed value carries no server-side spend — so its holder can replay it
     * for ten minutes with invented codes, and every replay is a request from
     * this API to Google's token endpoint. PKCE and Google's one-time codes
     * keep that harmless for authentication; this keeps it from spending the
     * client's quota for everybody. A person makes one callback per start, so
     * the honest path never meets it.
     */
    federatedCallback: createTokenRouteRateLimiter(
      config,
      store("federated-callback"),
    ),
    /**
     * The argon2 budget on `POST /admin/auth/onboarding/accept` (ADR-0071 §8).
     *
     * `passwordResetSubmit`'s twin in every respect, which is the argument for
     * it: an opaque token in the body, no address to key on, and a password
     * hashed before the token can be judged — so it needs the liveness control
     * ADR-0020 §Hashing cost describes, and it must not share a counter with
     * any endpoint whose key a caller can vary. Its own instance for
     * `invitationLookup`'s reason: a new colleague following the one link they
     * were sent must not be refused because somebody in the same office has
     * been mistyping a password all afternoon.
     */
    onboardingAccept: createTokenRouteRateLimiter(
      config,
      store("onboarding-accept"),
    ),
    /**
     * The mailbox's budget on §8's two senders — `POST /admin/staff` when it
     * invites, and the resend beside it (ADR-0071 §8, amended at `D18.11` on
     * that step's `security-reviewer`).
     *
     * §8's first draft gave them none, on two arguments the reviewer took
     * apart. "The create mails an address at most once, ever" is false: the
     * delete is **hard** (ADR-0028) and is the same caller's right, so
     * create-delete-create re-mails the same stranger at two requests a
     * message — §5's own defeat read one flow along. And "the resend goes to
     * the address on the row, which nothing can redirect" is true and bounds
     * the wrong axis: it closes redirection and says nothing at all about
     * repetition, which is what a mailbox budget is for.
     *
     * One instance for both, because they mail **the same message to the same
     * mailbox** and a counter each would be two budgets for one flow. What
     * they cannot share is the **key**, and the reason is structural rather
     * than a choice: at the create there is no row to name, and at the resend
     * there is no address in the request. So one mailbox is reached under two
     * keys — its address, and `subject:<id>` — and the honest ceiling is
     * `RATE_LIMIT_MAILBOX_MAX` **per key**, not per mailbox. That is a bound
     * where there was none, and it is stated here rather than rounded down in
     * the record: closing the gap would mean reading the row's address before
     * the limiter runs, which is a database read on the refused path and the
     * thing every key in this file is shaped to avoid.
     */
    staffOnboardingMailbox: createMailboxRateLimiter(
      config,
      store("staff-onboarding-mailbox"),
    ),
    /**
     * `POST /public/invitations/lookup` — ADR-0067 §5's first condition, which
     * ADR-0071 §5 inherits: a read scoped by nothing but a secret is limited
     * **as an authentication route is**, guessing being the only attack on it.
     *
     * The same factory and the same reason as `passwordResetSubmit` above: an
     * opaque token in the body and no address to key on, so the key is the
     * source and nothing a caller writes. Its own instance, so ten malformed
     * sign-in attempts from an office cannot stop its invitees reading the
     * link they were sent.
     */
    invitationLookup: createTokenRouteRateLimiter(
      config,
      store("invitation-lookup"),
    ),
    /**
     * `POST /user/orgs/:orgId/invitations` — the mailbox's own budget on the
     * one sender an *authenticated* caller drives (ADR-0071 §5, amended at
     * `D18.7` on that step's `security-reviewer`).
     *
     * §5 first said this send needed no budget, on the ground that ADR-0067
     * §2 refuses a second outstanding offer to one address in one
     * organization. That bound does not hold: an offer is revoked and made
     * again in two requests, and nothing caps how many organizations an
     * account may create — so "one per organization" is a bound the same
     * caller mints more of. The ceiling left was the global limiter, which is
     * hundreds an hour into a stranger's inbox from an address they never
     * gave anyone, carrying a subject line the sender chose.
     *
     * The mailbox key, because that is whose inbox it is, and a **counter of
     * its own**, because being invited must not spend the recovery budget for
     * the same address (`verification`'s reason exactly). Team onboarding is
     * untouched: the key is the recipient, so thirty invitations to thirty
     * people are thirty budgets.
     */
    invitationMailbox: createMailboxRateLimiter(
      config,
      store("invitation-mailbox"),
    ),
    /**
     * `POST /user/profile/password/set-link` — the set-password link
     * (ADR-0072 §3, amended at `D19.4`): the recovery budget's number, keyed
     * on the caller's account, in a counter of its own.
     *
     * The account is the key because the link goes to the account's own
     * address and nowhere else, so the caller and the mailbox are one budget.
     * Its own counter, so asking from the security section never spends the
     * budget `forgot` needs for the same address, or the other way round.
     */
    setPasswordLink: createSetPasswordLinkRateLimiter(
      config,
      store("set-password-link"),
    ),
    /**
     * `POST /user/profile/change-email` — the mailbox's budget on the second
     * authenticated sender (ADR-0071 §6, amended at `D18.9`).
     *
     * §4 leaves each authenticated sender's budget to the step that builds it,
     * and this one lands where the invitation's did, for the same reason read
     * one flow along: the address is a **stranger's**, typed by the caller, and
     * the message that goes to it names it. A session, a password and the
     * supersession of the previous token bound nothing about how many
     * different mailboxes one account can reach, or how often it can re-reach
     * one — so without this the only ceiling would be ADR-0020's global
     * limiter, which is the ceiling §5's amendment refused to accept for the
     * invitation.
     *
     * The **recipient** key rather than the actor's, which is what keeps the
     * honest case whole: a person who mistypes an address and asks again
     * spends a second mailbox's budget rather than their own. A counter of its
     * own, so being asked to confirm an address never spends the budget that
     * address needs to recover a password. And keyed on `newEmail`, which is
     * what this body calls the recipient.
     */
    emailChangeMailbox: createMailboxRateLimiter(
      config,
      store("email-change-mailbox"),
      // `skipFailedRequests` is the one place this endpoint's budget parts
      // company with §4's, and the route is why: it demands a credential and
      // refuses for reasons that mail nothing, while the limiter runs above
      // both the schema and the credential check. Five mistyped passwords
      // would otherwise lock a person out of moving to that address for the
      // rest of the hour (`D18.9`'s `code-reviewer`).
      { recipientField: "newEmail", skipFailedRequests: true },
    ),
    /**
     * The fifth category ADR-0020 §Residual risks named as missing, spent by
     * ADR-0073 §1: `10 / 15 min / **principal**` on every authenticated route
     * that verifies a password through the hash limiter.
     *
     * **One instance, mounted on every such route** — the admin segment's
     * credential and address sub-resources on staff and users, and the
     * self-service routes on `/user/profile` that verify the caller's own
     * password; the roster lives in the specs and the integration tier
     * (`D28.6`, `SEC-13`). The sharing is the decision here, where
     * `verification` and `passwordReset` separated for the opposite one: what
     * those ration is a mailbox, which differs per flow, and what this rations
     * is the caller's share of one process-wide hash pool, which does not. A
     * counter per route would multiply the decided number for one account to
     * spend in turn by the number of routes.
     */
    principalHash: createPrincipalHashRateLimiter(
      config,
      store("principal-hash"),
    ),
  }) as const;

/** The named set the segment routers mount from (ADR-0073 §10). */
export type RateLimiters = ReturnType<typeof createRateLimiters>;
