import type { PasswordHasher } from "@repo/crypto";
import type { DbExecutor } from "@repo/db";

import type { Audit } from "../../core/audit/index.js";
import type { AppConfig } from "../../core/config/index.js";
import type { MailSender, MailTemplates } from "../../core/mail/index.js";
import {
  createGoogleOidcProvider,
  createOidcTransactionCodec,
  oidcRedirectUri,
  type OidcProvider,
} from "../../core/oidc/index.js";
import type { AccountTokens } from "../../core/tokens/index.js";
import type { OrganizationsService } from "../organizations/index.js";
import type { StaffRepository } from "../staff/staff.repository.js";
import type { UsersRepository } from "../users/users.repository.js";
import { createAuthController } from "./auth.controller.js";
import type { AuthCookies } from "./auth.cookies.js";
import { createFederatedController } from "./auth.federated.controller.js";
import { createFederatedSignInService } from "./auth.federated.service.js";
import type { HashLimiter } from "./auth.hash-limiter.js";
import { createImpersonationController } from "./auth.impersonation.controller.js";
import { createHandoffsRepository } from "./auth.impersonation.repository.js";
import {
  createImpersonationService,
  type ImpersonationTargets,
} from "./auth.impersonation.service.js";
import {
  createFederatedAccounts,
  createStaffPrincipalAdapter,
  createUserPrincipalAdapter,
} from "./auth.principals.js";
import { createSessionsRepository } from "./auth.repository.js";
import { createAuthService } from "./auth.service.js";
import type { TokenService } from "./auth.tokens.js";

/** What the composition root hands this module (ADR-0073 §10). */
export interface WireAuthDeps {
  readonly config: AppConfig;
  readonly db: DbExecutor;
  /**
   * The two identity tables this module reads through its own adapters
   * (ADR-0017 §Principal abstraction in code) — the one place a module takes
   * another module's repository, and it takes it narrowed to a translation
   * that holds no logic.
   */
  readonly staffRepository: StaffRepository;
  readonly usersRepository: UsersRepository;
  /**
   * The raw hasher, not the capped one the feature modules get: login also
   * needs `needsRehash` and `dummyHash`, and it applies
   * {@link WireAuthDeps.hashLimiter} itself.
   */
  readonly hasher: PasswordHasher;
  /**
   * The process-wide argon2 concurrency cap (ADR-0020 §Hashing cost vs.
   * liveness). One instance for the whole process, built at the root: the
   * constraint it protects is the libuv thread pool.
   */
  readonly hashLimiter: HashLimiter;
  readonly tokens: TokenService;
  readonly cookies: AuthCookies;
  readonly audit: Audit;
  readonly accountTokens: AccountTokens;
  /** ADR-0066 §1's port. Never a mail client a service imports. */
  readonly mail: MailSender;
  /** ADR-0071 §2's messages, built from the two SPA origins at the root. */
  readonly mailTemplates: MailTemplates;
  /**
   * The organizations service: `register` and the federated sign-up are two of
   * the three paths that create a user, so each creates the personal
   * organization in the same commit (ADR-0067 §2).
   */
  readonly organizations: OrganizationsService;
  /**
   * The users service, narrowed to the one read impersonation needs: the
   * target of a mint is a customer account, and a module reaches another
   * module's *service* (ADR-0009, ADR-0057 §4).
   */
  readonly targets: ImpersonationTargets;
  /**
   * The ADR-0072 §2 identity-provider port, injected by a test only. The
   * Google adapter is built here when the client is configured; **the fake is
   * never chosen from configuration**, and the lint rule on `src/` refuses any
   * file outside the tests that imports it.
   */
  readonly oidc?: OidcProvider | undefined;
  /** Runs `fn` inside one database transaction (ADR-0006). */
  readonly transaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
}

/**
 * The auth module's wiring (ADR-0073 §10).
 *
 * The widest module in the repository and the reason ADR-0073 §10 exists: the
 * two population services, the impersonation mint and the federated sign-in
 * were three hundred lines of `core/container.ts`, which is the file a fork's
 * every merge conflicts in.
 */
export const wireAuth = ({
  config,
  db,
  staffRepository,
  usersRepository,
  hasher,
  hashLimiter,
  tokens,
  cookies,
  audit,
  accountTokens,
  mail,
  mailTemplates,
  organizations,
  targets,
  oidc: oidcOverride,
  transaction,
}: WireAuthDeps) => {
  const sessions = createSessionsRepository(db);
  const handoffs = createHandoffsRepository(db);

  const shared = {
    sessions,
    audit,
    hasher,
    tokens,
    hashLimiter,
    refreshTtlSec: config.auth.refreshTtlSec,
    rotationGraceSec: config.auth.refreshRotationGraceSec,
    // ADR-0073 §3's cap, on both populations: an operator accumulates sessions
    // exactly as a customer does.
    maxSessionsPerPrincipal: config.auth.maxSessionsPerPrincipal,
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
    ...shared,
    population: "staff",
    principals: staffPrincipals,
    // No `impersonators`, and the absence is the decision: a staff session is
    // never impersonated, because the mint is `/admin/users/:id` only
    // (ADR-0057 §4). A service that cannot look a staff member up is a service
    // that cannot accidentally attribute one.
  });

  // The user population's identity table as this module consumes it
  // (ADR-0072 §1): the sign-in's resolution below, and `me`'s answer to
  // "which ways in does this account have".
  const federatedAccounts = createFederatedAccounts(usersRepository);
  const userPrincipals = createUserPrincipalAdapter(usersRepository);

  const userAuth = createAuthService({
    ...shared,
    population: "user",
    principals: userPrincipals,
    // Narrowed by the service's own type to the read, the lock and the two
    // removals, and wired on this service alone: staff get no federated login
    // (ADR-0072 §5), so the staff reset has no identity to remove.
    federated: federatedAccounts,
    // The staff adapter, narrowed by the service's own type to `findById`: it
    // is what turns `sessions.impersonated_by_staff_id` into the
    // `impersonatedBy: { id, email }` the banner renders from (ADR-0057 §4).
    impersonators: staffPrincipals,
    // Wired on this service alone: `register` is the user segment's, and staff
    // cannot self-register (ADR-0017). Narrowed to the one function, so this
    // service cannot reach the rest of the organizations service.
    organizations,
  });

  /*
   * Sign in with Google (ADR-0072 §1, §2) — **built only when the client is
   * configured**, and `undefined` otherwise, which is what the public router
   * reads to leave the three routes unmounted. `config.federated.google` is
   * present only when both halves are set (the schema refuses half a pair),
   * so there is no state in which the flow exists without a client.
   *
   * The provider is the Google adapter unless a test handed the container
   * another one (see `WireAuthDeps.oidc`); the redirect URI is composed once,
   * here, from `API_PUBLIC_URL`, and is the string the console must hold.
   *
   * The transaction codec signs under the access tokens' key with its own
   * audience, `<APP_ID>-oidc`, so the two kinds of token can never be taken
   * for each other (`core/oidc/transaction.ts`).
   */
  const google = config.federated.google;
  const federatedSignIn =
    google === undefined
      ? undefined
      : createFederatedSignInService({
          provider:
            oidcOverride ??
            createGoogleOidcProvider({
              clientId: google.clientId,
              clientSecret: google.clientSecret,
              redirectUri: oidcRedirectUri(config.federated.apiPublicUrl),
            }),
          transactions: createOidcTransactionCodec({
            secret: config.auth.accessSecret,
            appId: config.app.id,
            issuer: config.auth.issuer,
          }),
          principals: userPrincipals,
          // One probe, for the link's callback: the identity joins the account
          // only while the session that asked is live (ADR-0072 §3, amended at
          // `D19.4`).
          sessions,
          accounts: federatedAccounts,
          // The third path that creates a user, so the personal organization
          // lands in the same commit (ADR-0067 §2).
          organizations,
          accountTokens,
          audit,
          // The flag's meaning, read for the second door as the first reads
          // it (ADR-0072 §1): with it off, a stranger is refused and nothing
          // is written.
          registrationOpen: config.features.userRegistration,
          // The handoff binding the callback leaves in the cookie lives as
          // long as the token it binds (ADR-0072 §2, amended at `D19.2`).
          handoffTtlSec: config.tokens.federatedHandoffTtlSec,
          transaction,
        });

  // The mint and the exchange (ADR-0057). It takes the **user** auth service,
  // because the session it opens is a customer's, and the users service
  // narrowed to one read, because the target is a customer account: both are
  // service-to-service edges of the kind ADR-0009 permits, and neither reaches
  // a table it does not own. The audit writer is passed whole — both lifecycle
  // rows are written on `record`'s transactional discipline (ADR-0058).
  const impersonation = createImpersonationService({
    handoffs,
    targets,
    sessions: userAuth,
    audit,
    handoffTtlSec: config.auth.impersonationHandoffTtlSec,
    transaction,
  });

  return {
    repositories: { sessions, handoffs } as const,
    services: {
      staffAuth,
      userAuth,
      impersonation,
      /** `undefined` unless the Google client is configured (ADR-0072 §2). */
      federatedSignIn,
    } as const,
    controllers: {
      // The population and the TTL are what the controller needs to place a
      // refresh cookie: the segment decides its `Path`, so a browser signed
      // into both populations never sends one's token to the other's
      // endpoints, and `REFRESH_TOKEN_TTL` is its `Max-Age` (ADR-0029).
      staffAuth: createAuthController({
        service: staffAuth,
        cookies,
        population: "staff",
        refreshTtlSec: config.auth.refreshTtlSec,
      }),
      userAuth: createAuthController({
        service: userAuth,
        cookies,
        population: "user",
        refreshTtlSec: config.auth.refreshTtlSec,
      }),
      /**
       * Sign in with Google (ADR-0072 §2), present exactly when the service
       * is — the public router mounts the three routes when this is defined
       * and not otherwise. It takes the **user** auth service for the
       * exchange, because the session it issues is a customer's and
       * `sessions` is that service's aggregate.
       */
      federated:
        federatedSignIn === undefined
          ? undefined
          : createFederatedController({
              service: federatedSignIn,
              auth: userAuth,
              cookies,
              refreshTtlSec: config.auth.refreshTtlSec,
              customerAppUrl: config.apps.customerUrl,
            }),
      // **One** controller for both segments: neither of its handlers can
      // reach the wrong segment. `mint` requires a staff principal, and
      // `exchange` is registered by the auth router only where the population
      // is `user` (ADR-0057 §3).
      impersonation: createImpersonationController({
        service: impersonation,
        cookies,
        refreshTtlSec: config.auth.refreshTtlSec,
      }),
    } as const,
  } as const;
};
