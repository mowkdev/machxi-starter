import { createArgon2Hasher } from "@repo/crypto";
import type { DbExecutor } from "@repo/db";
import type { Logger } from "@repo/logger";

import type { AppConfig } from "./config/index.js";
import type { DbClient } from "./db/index.js";
import {
  createAuthCookies,
  createAuthenticate,
  createHashLimiter,
  createRefuseImpersonated,
  createTokenService,
  wireAuth,
  type AuthService,
} from "../modules/auth/index.js";
import { createRateLimiters } from "./middleware/index.js";
import { wireHealth } from "../modules/health/index.js";
import {
  createRequireMembership,
  wireOrganizations,
} from "../modules/organizations/index.js";
import { wireSettings } from "../modules/settings/index.js";
import { wireStaff } from "../modules/staff/index.js";
import { wireUsers } from "../modules/users/index.js";
import { createAudit, createAuditRepository } from "./audit/index.js";
import { createCookieNames } from "./http/index.js";
import { createLimitedHasher } from "./auth/index.js";
import {
  createMailSender,
  createMailTemplates,
  type MailSender,
} from "./mail/index.js";
import { createMetrics } from "./metrics/index.js";
import { type OidcProvider } from "./oidc/index.js";
import {
  createAccountTokens,
  createAccountTokensRepository,
} from "./tokens/index.js";
import type { RateLimitStoreFactory } from "./rate-limit/index.js";
import { createErrorReporter, type ErrorReporter } from "./reporting/index.js";

/**
 * The composition root (ADR-0009, ADR-0073 §10).
 *
 * **Construction order and nothing else.** The process-wide singletons are
 * built at the top, then one `wire<Module>` per module in dependency order,
 * then the guards that hold a repository. What each module builds out of what
 * it is handed lives in that module's own `wire.ts`, so a fork that adds a
 * service changes a file of its own rather than this one — which is where
 * every fork's merge conflict used to land (ADR-0073 §10).
 *
 * There is still no DI container, no decorator and no service locator: reading
 * this file top to bottom tells you the order, and reading one `wire.ts` tells
 * you one module's graph. `createApp` needs nothing but the object returned
 * here.
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
   * keys on `prefix + key`, and several of the limiters key on the address
   * alone, so one shared instance would merge their counters. Absent — the
   * default, and what the whole test suite uses — every limiter gets
   * `express-rate-limit`'s own in-memory store, which is per instance already.
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
  /**
   * The ADR-0072 §2 identity-provider port, used **only when the Google
   * client is configured** — and then normally the Google adapter, built
   * inside `wireAuth` from `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and
   * `API_PUBLIC_URL`.
   *
   * Overridable for {@link ContainerDeps.mail}'s reason: the integration
   * tier drives the callback against the fake, because the one thing no test
   * may reach is Google. **The fake is never chosen from configuration**
   * (`D19.1`'s `security-reviewer`): no file under `src/` imports it, and the
   * lint rule refuses any that does. The only way to run the flow against it
   * is to be a test that built a container.
   */
  readonly oidc?: OidcProvider | undefined;
}

/**
 * One module's view of another module's session revocation, resolved when it
 * is called rather than when it is wired (ADR-0009's service-to-service edge).
 *
 * The module graph has one cycle in it and always has: the staff and users
 * services end an account's sessions through the auth service of their
 * population, and the auth module's impersonation mint reads its target
 * through the users service. Something has to be late, and this is the
 * smallest thing that can be — the *narrowing* those two services already
 * declare (`Pick<AuthService, "revokeSessionsFor">`), written out instead of
 * inferred from a whole service handed over early.
 *
 * It changes no call: the forwarded arguments and the returned promise are the
 * auth service's own.
 */
const revocationOf = (
  service: () => Pick<AuthService, "revokeSessionsFor">,
): Pick<AuthService, "revokeSessionsFor"> => ({
  revokeSessionsFor: (...args) => service().revokeSessionsFor(...args),
});

export const buildContainer = ({
  config,
  db,
  logger,
  rateLimitStore = () => undefined,
  reporter,
  mail: mailOverride,
  oidc: oidcOverride,
}: ContainerDeps) => {
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

  // Hashing with the ADR-0020 cap already applied. The feature modules get
  // *this* and never the raw hasher, so they cannot bypass the cap by
  // forgetting to wrap a call; the auth module keeps the raw one because
  // login also needs `needsRehash` and `dummyHash`.
  const limitedHasher = createLimitedHasher({ hasher, limiter: hashLimiter });

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
   * ADR-0066 §1's port and ADR-0071 §2's messages, built here for the reason
   * everything else stateful is — a transporter holds a connection pool — and
   * built **before** the modules, because both are dependencies of three of
   * them.
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

  /**
   * The one mint and the one consume behind every mail flow (ADR-0071 §1),
   * built here for the audit writer's reason: the mechanism is infrastructure
   * the feature modules borrow, and the purposes belong to the features.
   *
   * The TTL map is the point of building it at the composition root. Each
   * purpose has its own window and only this file can see all of them
   * (`core/config` holds the numbers, `@repo/contracts` holds the purposes), so
   * a new purpose fails `pnpm check-types` here until somebody decides how
   * long its token should live — which is what `federated_login` did at
   * `D19.1`.
   *
   * Not `tokens` — that name is taken by the access-token service above, and
   * an *account* token is the opposite kind of credential: opaque, stored as a
   * hash, single-use, and redeemed rather than presented.
   */
  const accountTokens = createAccountTokens({
    repository: createAccountTokensRepository(db.db),
    ttlSecByPurpose: {
      verify_email: config.tokens.verificationTtlSec,
      reset_password: config.tokens.passwordResetTtlSec,
      change_email: config.tokens.emailChangeTtlSec,
      staff_onboarding: config.tokens.staffOnboardingTtlSec,
      // The federated sign-in handoff (ADR-0072 §2): no message carries it,
      // the callback's redirect does, and its window is the impersonation
      // handoff's sixty seconds for the same reason.
      federated_login: config.tokens.federatedHandoffTtlSec,
    },
    transaction,
  });

  // The remaining two ADR-0066 seams (the mail port is built above), both here
  // for the reason everything else stateful is: a metrics registry and a
  // memoised adapter promise belong to the composition root.
  //
  // `createErrorReporter` returns `undefined` in a default clone, while the
  // registry is always built, because the registry *is* the endpoint.
  const metrics = createMetrics();
  const errorReporter =
    reporter ?? createErrorReporter({ dsn: config.reporting.dsn, logger });

  // Every limiter this process mounts, built once from the configuration and
  // the store factory (ADR-0073 §10). A limiter holds the counter, so one
  // instance per budget and never one per mount — the argument is in
  // `core/middleware/rate-limiters.ts`, beside the factories it calls.
  const rateLimiters = createRateLimiters(config, rateLimitStore);

  // ---------------------------------------------------------------------
  // The modules, in dependency order (ADR-0073 §10).
  // ---------------------------------------------------------------------

  const health = wireHealth({ config, db });

  const settings = wireSettings({ db: db.db, transaction });

  // Before staff, users and auth: it owns the personal organization's
  // lifecycle, and every path that creates or deletes a user runs it inside
  // that path's own transaction (ADR-0067 §2).
  const organizations = wireOrganizations({
    config,
    db: db.db,
    mail,
    mailTemplates,
    transaction,
  });

  const staff = wireStaff({
    db: db.db,
    hasher: limitedHasher,
    sessions: revocationOf(() => auth.services.staffAuth),
    audit,
    accountTokens,
    mail,
    mailTemplates,
    transaction,
  });

  const users = wireUsers({
    db: db.db,
    hasher: limitedHasher,
    sessions: revocationOf(() => auth.services.userAuth),
    // `POST /api/v1/admin/users/:id/password` has a *staff* member acting, so
    // the actor's own password is verified by the module that owns the staff
    // aggregate (ADR-0027 rule 1, ADR-0009).
    actors: staff.services.staff,
    organizations: organizations.services.organizations,
    locales: settings.services.settings,
    accountTokens,
    audit,
    mail,
    mailTemplates,
    cookies: authCookies,
    transaction,
  });

  // Last, because it reads both identity tables through its own adapters and
  // mints impersonated sessions against the users service.
  const auth = wireAuth({
    config,
    db: db.db,
    staffRepository: staff.repositories.staff,
    usersRepository: users.repositories.users,
    hasher,
    hashLimiter,
    tokens,
    cookies: authCookies,
    audit,
    accountTokens,
    mail,
    mailTemplates,
    organizations: organizations.services.organizations,
    targets: users.services.users,
    oidc: oidcOverride,
    transaction,
  });

  // The guards the segment routers mount. Each holds a repository or the audit
  // writer, so it is built here rather than in a router file (ADR-0019).
  const authenticate = createAuthenticate({
    tokens,
    sessions: auth.repositories.sessions,
  });

  // ADR-0057 §5's exclusion list, as one guard named in the router files that
  // mount it. Built here because it holds the audit writer: an excluded
  // operation attempted is itself an audit event.
  const refuseImpersonated = createRefuseImpersonated({ audit });

  // The third guard (ADR-0067 §4, a delta on ADR-0019), over the memberships
  // repository.
  const requireMembership = createRequireMembership({
    memberships: organizations.repositories.memberships,
  });

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
      staff: staff.repositories.staff,
      users: users.repositories.users,
      sessions: auth.repositories.sessions,
      handoffs: auth.repositories.handoffs,
      settings: settings.repositories.settings,
      organizations: organizations.repositories.organizations,
      memberships: organizations.repositories.memberships,
      invitations: organizations.repositories.invitations,
    } as const,
    services: {
      health: health.services.health,
      staffAuth: auth.services.staffAuth,
      userAuth: auth.services.userAuth,
      staff: staff.services.staff,
      users: users.services.users,
      settings: settings.services.settings,
      impersonation: auth.services.impersonation,
      organizations: organizations.services.organizations,
      /** `undefined` unless the Google client is configured (ADR-0072 §2). */
      federatedSignIn: auth.services.federatedSignIn,
    } as const,
    controllers: {
      health: health.controllers.health,
      staffAuth: auth.controllers.staffAuth,
      userAuth: auth.controllers.userAuth,
      staff: staff.controllers.staff,
      users: users.controllers.users,
      userProfile: users.controllers.userProfile,
      staffProfile: staff.controllers.staffProfile,
      settings: settings.controllers.settings,
      federated: auth.controllers.federated,
      impersonation: auth.controllers.impersonation,
      userOrganizations: organizations.controllers.userOrganizations,
      userInvitations: organizations.controllers.userInvitations,
      publicInvitations: organizations.controllers.publicInvitations,
      organizations: organizations.controllers.organizations,
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
