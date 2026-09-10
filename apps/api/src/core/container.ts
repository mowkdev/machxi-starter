import { createArgon2Hasher } from "@repo/crypto";
import type { DbExecutor } from "@repo/db";
import type { Logger } from "@repo/logger";

import type { AppConfig } from "./config/index.js";
import type { DbClient } from "./db/index.js";
import {
  createAuthController,
  createAuthCookies,
  createAuthenticate,
  createAuthService,
  createHandoffsRepository,
  createHashLimiter,
  createImpersonationController,
  createImpersonationService,
  createRefuseImpersonated,
  createSessionsRepository,
  createStaffPrincipalAdapter,
  createTokenService,
  createUserPrincipalAdapter,
} from "../modules/auth/index.js";
import {
  createGlobalRateLimiter,
  createImpersonationRateLimiter,
  createLoginRateLimiter,
  createMailboxRateLimiter,
  createMailSourceRateLimiter,
  createPasswordResetRateLimiter,
  createRefreshRateLimiter,
  createTokenRouteRateLimiter,
  createVerificationRateLimiter,
} from "./middleware/index.js";
import {
  createDbIndicator,
  createHealthController,
  createHealthService,
} from "../modules/health/index.js";
import {
  createInvitationsRepository,
  createMembershipsRepository,
  createOrganizationsController,
  createOrganizationsRepository,
  createOrganizationsService,
  createPublicInvitationsController,
  createRequireMembership,
  createUserInvitationsController,
  createUserOrganizationsController,
} from "../modules/organizations/index.js";
import {
  createSettingsController,
  createSettingsRepository,
  createSettingsService,
} from "../modules/settings/index.js";
import {
  createStaffController,
  createStaffProfileController,
  createStaffRepository,
  createStaffService,
} from "../modules/staff/index.js";
import {
  createUserProfileController,
  createUsersController,
  createUsersRepository,
  createUsersService,
} from "../modules/users/index.js";
import { createAudit, createAuditRepository } from "./audit/index.js";
import { createCookieNames } from "./http/index.js";
import { createLimitedHasher } from "./auth/index.js";
import {
  createMailSender,
  createMailTemplates,
  type MailSender,
} from "./mail/index.js";
import { createMetrics } from "./metrics/index.js";
import {
  createAccountTokens,
  createAccountTokensRepository,
} from "./tokens/index.js";
import type { RateLimitStoreFactory } from "./rate-limit/index.js";
import { createErrorReporter, type ErrorReporter } from "./reporting/index.js";

/**
 * The composition root (ADR-0009).
 *
 * Everything is built once, here, in dependency order, by calling the module
 * factories — no DI container, no decorators, no service locator. Reading this
 * file top to bottom tells you the whole dependency graph of the process, and
 * `createApp` needs nothing but the object it returns.
 *
 * Tests build a container against a test database and get the real wiring
 * (ADR-0021); a unit test skips it entirely and calls one `create*Service`
 * with plain-object repositories.
 */
export interface ContainerDeps {
  readonly config: AppConfig;
  /** Already connected and probed by `main.ts` (ADR-0003). */
  readonly db: DbClient;
  readonly logger: Logger;
  /**
   * The shared rate-limit store (ADR-0066 §4), built and connected by
   * `main.ts` because a Redis client's `connect` is asynchronous and this
   * factory is not.
   *
   * A **factory taking the limiter's name**, not one store: `rate-limit-redis`
   * keys on `prefix + key`, and three of the four limiters key on the address
   * alone, so one shared instance would merge the global and refresh counters.
   * Absent — the default, and what the whole test suite uses — every limiter
   * gets `express-rate-limit`'s own in-memory store, which is per instance
   * already.
   */
  readonly rateLimitStore?: RateLimitStoreFactory;
  /**
   * The error-reporting seam (ADR-0066 §3). Normally built here from
   * `ERROR_REPORTING_DSN`; the integration suite passes a stub, because "a
   * 5xx reaches the reporter and a 4xx does not" is a property of the error
   * handler and there is nothing to learn from a third party's SDK.
   */
  readonly reporter?: ErrorReporter | undefined;
  /**
   * The ADR-0066 §1 mail port, normally chosen from `MAIL_TRANSPORT`.
   *
   * Overridable for the reason {@link ContainerDeps.reporter} is: the
   * integration suite has to read the **link** a flow sent, and neither
   * adapter is a place to read it from — the log transport deliberately writes
   * the recipient and the subject and never the body, because that body is a
   * single-use bearer credential (ADR-0057 §2), and the SMTP one needs a
   * server. A capturing sender is the seam's own shape, so what the suite
   * exercises is the real wiring with the real templates.
   */
  readonly mail?: MailSender | undefined;
}

export const buildContainer = ({
  config,
  db,
  logger,
  rateLimitStore = () => undefined,
  reporter,
  mail: mailOverride,
}: ContainerDeps) => {
  const health = createHealthService({
    // The database is the only registered indicator in the first deliverable
    // (ADR-0016); a cache or a queue is one more entry in this array.
    indicators: [createDbIndicator(db)],
    config,
  });

  // One hasher for the process, built from the validated `ARGON2_*` values.
  // The seeders build their own from the same variables (ADR-0008), which is
  // what makes a seeded password verify against what the API expects.
  const hasher = createArgon2Hasher(config.auth.argon2);

  // One limiter shared by both populations: the constraint it protects is the
  // libuv thread pool, which is per process, not per population (ADR-0020
  // §Hashing cost vs. liveness).
  const hashLimiter = createHashLimiter({
    maxConcurrent: config.auth.maxConcurrentHashes,
  });

  // Every browser-visible name this deployment answers to, derived once from
  // `APP_ID` (ADR-0064 §1). One object, so the controller that writes a cookie
  // and the guard that reads it cannot be built from two copies of the
  // identifier and disagree.
  const cookieNames = createCookieNames(config.app.id);
  const authCookies = createAuthCookies(cookieNames);

  const tokens = createTokenService({
    secret: config.auth.accessSecret,
    appId: config.app.id,
    issuer: config.auth.issuer,
    accessTtlSec: config.auth.accessTtlSec,
  });

  const staffRepository = createStaffRepository(db.db);
  const usersRepository = createUsersRepository(db.db);
  const sessions = createSessionsRepository(db.db);
  const handoffs = createHandoffsRepository(db.db);
  const settingsRepository = createSettingsRepository(db.db);
  const organizationsRepository = createOrganizationsRepository(db.db);
  const memberships = createMembershipsRepository(db.db);
  const invitations = createInvitationsRepository(db.db);

  // The one place that knows how to open a transaction. Repositories take a
  // `DbExecutor` (ADR-0006), so a service composes them without ever importing
  // the client.
  const transaction = <T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> =>
    db.db.transaction(fn);

  // The audit writer (ADR-0058). Core rather than a feature module: the
  // mechanism is infrastructure every module borrows, like the logger and the
  // context, while the event names belong to the features that write them. It
  // takes `ctx` first and no transaction of its own — a lifecycle row is
  // written on the caller's executor, which is what makes "an operation that
  // cannot be audited does not happen" a property of the database rather than
  // of a convention.
  const audit = createAudit({ repository: createAuditRepository(db.db) });

  /**
   * The one mint and the one consume behind every mail flow (ADR-0071 §1),
   * built here for the audit writer's reason: the mechanism is infrastructure
   * the feature modules borrow, and the purposes belong to the features.
   *
   * The TTL map is the point of building it at the composition root. Each
   * purpose has its own window and only this file can see all four
   * (`core/config` holds the numbers, `@repo/contracts` holds the purposes), so
   * a fifth purpose fails `pnpm check-types` here until somebody decides how
   * long its link should live.
   *
   * Not `tokens` — that name is taken by the access-token service above, and
   * an *account* token is the opposite kind of credential: opaque, stored as a
   * hash, single-use, and redeemed rather than presented.
   *
   * Its first callers are ADR-0071 §3's registration and verification; the
   * flows that follow mint and consume through the same two functions.
   */
  /**
   * ADR-0066 §1's port and ADR-0071 §2's messages, built here for the reason
   * everything else stateful is — a transporter holds a connection pool — and
   * built **before** the auth services because both are dependencies of them
   * (ADR-0071 §3 mounts the first flow that sends).
   *
   * `createMailSender` returns the log transport in a default clone, so a
   * fresh checkout runs with no mail server and every flow below still
   * completes; the templates take the two SPA origins once, because a template
   * that took an origin per call would let a caller choose where a single-use
   * credential is delivered.
   */
  const mail = mailOverride ?? createMailSender(config);
  const mailTemplates = createMailTemplates({
    customerUrl: config.apps.customerUrl,
    adminUrl: config.apps.adminUrl,
  });

  const accountTokens = createAccountTokens({
    repository: createAccountTokensRepository(db.db),
    ttlSecByPurpose: {
      verify_email: config.tokens.verificationTtlSec,
      reset_password: config.tokens.passwordResetTtlSec,
      change_email: config.tokens.emailChangeTtlSec,
      staff_onboarding: config.tokens.staffOnboardingTtlSec,
    },
    transaction,
  });

  // Built before the auth and users services, because both depend on it and
  // it depends on neither: it owns the personal organization's lifecycle, and
  // every path that creates or deletes a user runs it inside that path's own
  // transaction (ADR-0067 §2, ADR-0009's service-to-service edge).
  const organizationsService = createOrganizationsService({
    repository: organizationsRepository,
    memberships,
    invitations,
    // `ORGANIZATION_INVITATION_TTL` (ADR-0004), threaded rather than read: a
    // service reads no environment (ADR-0004's one-place rule).
    invitationTtlSec: config.organizations.invitationTtlSec,
    transaction,
    // ADR-0066 §1's port and ADR-0071 §2's messages, the same two instances
    // the auth services take: §2's marked call is a real send from `D18.7` on.
    mail,
    mailTemplates,
  });

  // The third guard (ADR-0067 §4, a delta on ADR-0019). A factory over the
  // memberships repository, so it is built here rather than in a router file
  // for the reason `authenticate` is.
  const requireMembership = createRequireMembership({ memberships });

  const authDeps = {
    sessions,
    audit,
    hasher,
    tokens,
    hashLimiter,
    refreshTtlSec: config.auth.refreshTtlSec,
    rotationGraceSec: config.auth.refreshRotationGraceSec,
    impersonationSessionTtlSec: config.auth.impersonationSessionTtlSec,
    // ADR-0071 §1's mechanism and ADR-0066 §1's port, on both populations:
    // verification is the user segment's (§3) and the reset is both (§4).
    accountTokens,
    mail,
    mailTemplates,
    transaction,
  } as const;

  // The same service, twice. Everything population-specific is behind the
  // adapter (ADR-0017 §Principal abstraction in code), so login, rotation,
  // reuse detection and revocation exist once.
  const staffPrincipals = createStaffPrincipalAdapter(staffRepository);

  const staffAuth = createAuthService({
    ...authDeps,
    population: "staff",
    principals: staffPrincipals,
    // No `impersonators`, and the absence is the decision: a staff session is
    // never impersonated, because the mint is `/admin/users/:id` only
    // (ADR-0057 §4). A service that cannot look a staff member up is a service
    // that cannot accidentally attribute one.
  });

  const userAuth = createAuthService({
    ...authDeps,
    population: "user",
    principals: createUserPrincipalAdapter(usersRepository),
    // The staff adapter, narrowed by the service's own type to `findById`: it
    // is what turns `sessions.impersonated_by_staff_id` into the
    // `impersonatedBy: { id, email }` the banner renders from (ADR-0057 §4).
    impersonators: staffPrincipals,
    // Wired on this service alone: `register` is the user segment's, and staff
    // cannot self-register (ADR-0017). Narrowed to the one function, so the
    // auth module cannot reach the rest of the organizations service.
    organizations: organizationsService,
  });

  const authenticate = createAuthenticate({ tokens, sessions });

  // ADR-0057 §5's exclusion list, as one guard named in the router files that
  // mount it (ADR-0019). Built here because it holds the audit writer: an
  // excluded operation attempted is itself an audit event.
  const refuseImpersonated = createRefuseImpersonated({ audit });

  // Hashing with the ADR-0020 cap already applied. The feature services get
  // *this* and never the raw hasher, so they cannot bypass the cap by
  // forgetting to wrap a call; the auth service keeps the raw one because
  // login also needs `needsRehash` and `dummyHash`.
  const limitedHasher = createLimitedHasher({ hasher, limiter: hashLimiter });

  // Each takes the auth service of its own population, narrowed to
  // `revokeSessionsFor`: `sessions` is the auth module's aggregate, so
  // "disable this account and end its sessions" crosses modules through a
  // service rather than through a repository (ADR-0009).
  const staffService = createStaffService({
    repository: staffRepository,
    hasher: limitedHasher,
    sessions: staffAuth,
    // The one row this module writes for itself (ADR-0058, ADR-0071 §7), and
    // the token service that flow supersedes a live `change_email` link
    // through (ADR-0071 §1).
    audit,
    accountTokens,
    // ADR-0066 §1's port and ADR-0071 §2's messages, for the flow this module
    // owns end to end but for the consume: a staff member created without a
    // password is `invited` and is mailed an onboarding link (§8). The link
    // lands on the **admin** app, which is why `mailTemplates` is built from
    // both origins above.
    mail,
    mailTemplates,
    transaction,
  });

  // One service for both segments and both tables (ADR-0045). It takes no
  // hasher and no session dependency: a settings row holds display state and
  // nothing a credential or a session could be reached through.
  const settingsService = createSettingsService({
    repository: settingsRepository,
    transaction,
  });

  const usersService = createUsersService({
    repository: usersRepository,
    hasher: limitedHasher,
    sessions: userAuth,
    // The account's own language, for the one message this module sends
    // (ADR-0071 §2, §6): a locale is an account fact, and which of the two
    // settings tables holds it is the settings service's business rather than
    // this module's. Narrowed to `get`, like every other edge here.
    locales: settingsService,
    // ADR-0071 §1's mint and ADR-0066 §1's port: `change-email` mails a
    // confirmation link to an address nobody has proven yet, and the address
    // waits in the token's payload until somebody does (§6). The *consume* is
    // the auth module's, because the link is followed without a session.
    accountTokens,
    mail,
    mailTemplates,
    // Built above, and the only dependency between two *feature* modules in
    // this file — the `sessions` lines are feature-to-auth, which is the edge
    // ADR-0009 was amended about. `POST /api/v1/admin/users/:id/password` has a
    // *staff* member acting, so the actor's own password is verified by the
    // module that owns the staff aggregate (ADR-0027 rule 1, ADR-0009).
    // `account.email_changed` for the administrative half of the flow
    // (ADR-0071 §7): the actor is the super admin on the context and the
    // subject rides in the row's data.
    audit,
    actors: staffService,
    // The three writes ADR-0067 §2 requires to be transactional with the
    // account they are about: `POST /admin/users` creates the personal
    // organization, and both deletion paths soft-delete it.
    organizations: organizationsService,
    transaction,
  });

  // The mint and the exchange (ADR-0057). It takes the **user** auth service,
  // because the session it opens is a customer's, and the users service
  // narrowed to one read, because the target is a customer account: both are
  // service-to-service edges of the kind ADR-0009 permits, and neither reaches
  // a table it does not own. The audit writer is passed whole — both lifecycle
  // rows are written on `record`'s transactional discipline (ADR-0058).
  const impersonationService = createImpersonationService({
    handoffs,
    targets: usersService,
    sessions: userAuth,
    audit,
    handoffTtlSec: config.auth.impersonationHandoffTtlSec,
    transaction,
  });

  // Built **here**, not in the route factories, because a limiter holds the
  // counter: constructing one per mount would give the same IP+email a fresh
  // budget on every segment, so ADR-0020's "10 per 15 minutes on login" would
  // really be ten per login endpoint. Stateful components belong to the
  // composition root (ADR-0009), and this is why.
  const rateLimiters = {
    global: createGlobalRateLimiter(config, rateLimitStore("global")),
    /** Shared by both segments' `login` and by `register` (ADR-0018). */
    login: createLoginRateLimiter(config, rateLimitStore("login")),
    refresh: createRefreshRateLimiter(config, rateLimitStore("refresh")),
    /**
     * The mint's own budget, and the only limiter here keyed on a principal
     * rather than an address (ADR-0057 §1). Built here for the reason all the
     * others are — one instance holds one counter — and mounted inside the
     * admin segment, after `authenticate`, because its key does not exist
     * before that.
     */
    impersonation: createImpersonationRateLimiter(
      config,
      rateLimitStore("impersonation"),
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
      rateLimitStore("password-reset"),
    ),
    verification: createVerificationRateLimiter(
      config,
      rateLimitStore("verification"),
    ),
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
    mailbox: createMailboxRateLimiter(config, rateLimitStore("mailbox")),
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
    mailSource: createMailSourceRateLimiter(
      config,
      rateLimitStore("mail-source"),
    ),
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
      rateLimitStore("password-reset-submit"),
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
      rateLimitStore("onboarding-accept"),
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
      rateLimitStore("staff-onboarding-mailbox"),
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
      rateLimitStore("invitation-lookup"),
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
      rateLimitStore("invitation-mailbox"),
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
      rateLimitStore("email-change-mailbox"),
      // `skipFailedRequests` is the one place this endpoint's budget parts
      // company with §4's, and the route is why: it demands a credential and
      // refuses for reasons that mail nothing, while the limiter runs above
      // both the schema and the credential check. Five mistyped passwords
      // would otherwise lock a person out of moving to that address for the
      // rest of the hour (`D18.9`'s `code-reviewer`).
      { recipientField: "newEmail", skipFailedRequests: true },
    ),
  } as const;

  // The remaining two ADR-0066 seams (the mail port is built above, where the
  // auth services can take it), both here for the reason everything else
  // stateful is: a metrics registry and a memoised adapter promise belong to
  // the composition root.
  //
  // `createErrorReporter` returns `undefined` in a default clone, while the
  // registry is always built, because the registry *is* the endpoint.
  const metrics = createMetrics();
  const errorReporter =
    reporter ?? createErrorReporter({ dsn: config.reporting.dsn, logger });

  return {
    config,
    db,
    logger,
    /** The cookie names the segment routers hand to their CSRF guards. */
    cookieNames,
    hasher,
    audit,
    authenticate,
    refuseImpersonated,
    /** ADR-0067 §4's third guard, mounted by the `/user/orgs` routers. */
    requireMembership,
    rateLimiters,
    mail,
    mailTemplates,
    metrics,
    /** `undefined` unless a DSN is configured or a test supplied a stub. */
    reporter: errorReporter,
    /** ADR-0071 §1's mechanism, mounted by the flows from `D18.3` on. */
    accountTokens,
    repositories: {
      staff: staffRepository,
      users: usersRepository,
      sessions,
      handoffs,
      settings: settingsRepository,
      organizations: organizationsRepository,
      memberships,
      invitations,
    } as const,
    services: {
      health,
      staffAuth,
      userAuth,
      staff: staffService,
      users: usersService,
      settings: settingsService,
      impersonation: impersonationService,
      organizations: organizationsService,
    } as const,
    controllers: {
      health: createHealthController(health),
      // The population and the TTL are what the controller needs to place a
      // refresh cookie: the segment decides its `Path`, so a browser signed
      // into both populations never sends one's token to the other's
      // endpoints, and `REFRESH_TOKEN_TTL` is its `Max-Age` (ADR-0029).
      staffAuth: createAuthController({
        service: staffAuth,
        cookies: authCookies,
        population: "staff",
        refreshTtlSec: config.auth.refreshTtlSec,
      }),
      userAuth: createAuthController({
        service: userAuth,
        cookies: authCookies,
        population: "user",
        refreshTtlSec: config.auth.refreshTtlSec,
      }),
      staff: createStaffController(staffService),
      users: createUsersController(usersService),
      // The same service behind a second controller: `/api/v1/user/profile`
      // exposes only the functions that read their subject from
      // `ctx.principal`, so the admin handlers are not reachable from the user
      // segment even by a routing mistake (ADR-0019).
      userProfile: createUserProfileController({
        service: usersService,
        cookies: authCookies,
      }),
      // The same pairing on the staff side since D2.3: `/api/v1/admin/profile`
      // exposes only the functions that read their subject from
      // `ctx.principal`, so no handler taking an `:id` is reachable from it
      // (ADR-0027).
      staffProfile: createStaffProfileController(staffService),
      // **One** controller for both segments, unlike the profile pairs above:
      // neither of its handlers takes an id, so there is nothing a second
      // factory would withhold from the other mount (ADR-0045).
      settings: createSettingsController(settingsService),
      // **One** controller for both segments as well, and for a stronger
      // reason than the settings pair: neither handler can reach the wrong
      // segment. `mint` requires a staff principal, and `exchange` is
      // registered by the auth router only where the population is `user`
      // (ADR-0057 §3).
      impersonation: createImpersonationController({
        service: impersonationService,
        cookies: authCookies,
        refreshTtlSec: config.auth.refreshTtlSec,
      }),
      /*
       * **Three** controllers over one organizations service, one per mount
       * (ADR-0067 §3, §4) — the users module's pairing taken one further,
       * and for its reason: a factory can only expose what its segment is
       * allowed to reach. `createForOwner` names an owner by id and exists
       * only on the admin controller; the invitee's accept and decline exist
       * only on the self-scoped one; and neither of those two can reach a
       * handler that takes an organization from the URL.
       */
      userOrganizations:
        createUserOrganizationsController(organizationsService),
      userInvitations: createUserInvitationsController(organizationsService),
      // The fourth mount of the same service, and the only one outside every
      // guard: the holder of an invitation link has no account yet
      // (ADR-0071 §5).
      publicInvitations:
        createPublicInvitationsController(organizationsService),
      organizations: createOrganizationsController(organizationsService),
    } as const,

    /**
     * Work that must finish before the port is bound (ADR-0003).
     *
     * Right now that is exactly one thing: computing the dummy password hash.
     * It is memoised inside the hasher, so warming it here means an
     * unknown-email login pays a verify like every other login. Left cold, the
     * first one pays hash *plus* verify — measurably longer, and the timing
     * oracle `dummyHash` exists to close (ADR-0018 §Password hashing).
     */
    warmup: async (): Promise<void> => {
      await hasher.dummyHash();
    },
  } as const;
};

export type Container = ReturnType<typeof buildContainer>;
