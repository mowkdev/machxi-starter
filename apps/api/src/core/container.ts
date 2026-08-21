import { createArgon2Hasher } from "@repo/crypto";
import type { DbExecutor } from "@repo/db";
import type { Logger } from "@repo/logger";

import type { AppConfig } from "./config/index.js";
import type { DbClient } from "./db/index.js";
import {
  createAuthController,
  createAuthenticate,
  createAuthService,
  createHashLimiter,
  createSessionsRepository,
  createStaffPrincipalAdapter,
  createTokenService,
  createUserPrincipalAdapter,
} from "../modules/auth/index.js";
import {
  createGlobalRateLimiter,
  createLoginRateLimiter,
  createRefreshRateLimiter,
} from "./middleware/index.js";
import {
  createDbIndicator,
  createHealthController,
  createHealthService,
} from "../modules/health/index.js";
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
import { createLimitedHasher } from "./auth/index.js";

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
}

export const buildContainer = ({ config, db, logger }: ContainerDeps) => {
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

  const tokens = createTokenService({
    secret: config.auth.accessSecret,
    issuer: config.auth.issuer,
    accessTtlSec: config.auth.accessTtlSec,
  });

  const staffRepository = createStaffRepository(db.db);
  const usersRepository = createUsersRepository(db.db);
  const sessions = createSessionsRepository(db.db);
  const settingsRepository = createSettingsRepository(db.db);

  // The one place that knows how to open a transaction. Repositories take a
  // `DbExecutor` (ADR-0006), so a service composes them without ever importing
  // the client.
  const transaction = <T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> =>
    db.db.transaction(fn);

  const authDeps = {
    sessions,
    hasher,
    tokens,
    hashLimiter,
    refreshTtlSec: config.auth.refreshTtlSec,
    rotationGraceSec: config.auth.refreshRotationGraceSec,
    transaction,
  } as const;

  // The same service, twice. Everything population-specific is behind the
  // adapter (ADR-0017 §Principal abstraction in code), so login, rotation,
  // reuse detection and revocation exist once.
  const staffAuth = createAuthService({
    ...authDeps,
    population: "staff",
    principals: createStaffPrincipalAdapter(staffRepository),
  });

  const userAuth = createAuthService({
    ...authDeps,
    population: "user",
    principals: createUserPrincipalAdapter(usersRepository),
  });

  const authenticate = createAuthenticate({ tokens, sessions });

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
    transaction,
  });

  const usersService = createUsersService({
    repository: usersRepository,
    hasher: limitedHasher,
    sessions: userAuth,
    // Built above, and the only dependency between two *feature* modules in
    // this file — the `sessions` lines are feature-to-auth, which is the edge
    // ADR-0009 was amended about. `POST /api/v1/admin/users/:id/password` has a
    // *staff* member acting, so the actor's own password is verified by the
    // module that owns the staff aggregate (ADR-0027 rule 1, ADR-0009).
    actors: staffService,
    transaction,
  });

  // One service for both segments and both tables (ADR-0045). It takes no
  // hasher and no session dependency: a settings row holds display state and
  // nothing a credential or a session could be reached through.
  const settingsService = createSettingsService({
    repository: settingsRepository,
    transaction,
  });

  // Built **here**, not in the route factories, because a limiter holds the
  // counter: constructing one per mount would give the same IP+email a fresh
  // budget on every segment, so ADR-0020's "10 per 15 minutes on login" would
  // really be ten per login endpoint. Stateful components belong to the
  // composition root (ADR-0009), and this is why.
  const rateLimiters = {
    global: createGlobalRateLimiter(config),
    /** Shared by both segments' `login` and by `register` (ADR-0018). */
    login: createLoginRateLimiter(config),
    refresh: createRefreshRateLimiter(config),
  } as const;

  return {
    config,
    db,
    logger,
    hasher,
    authenticate,
    rateLimiters,
    repositories: {
      staff: staffRepository,
      users: usersRepository,
      sessions,
      settings: settingsRepository,
    } as const,
    services: {
      health,
      staffAuth,
      userAuth,
      staff: staffService,
      users: usersService,
      settings: settingsService,
    } as const,
    controllers: {
      health: createHealthController(health),
      // The population and the TTL are what the controller needs to place a
      // refresh cookie: the segment decides its `Path`, so a browser signed
      // into both populations never sends one's token to the other's
      // endpoints, and `REFRESH_TOKEN_TTL` is its `Max-Age` (ADR-0029).
      staffAuth: createAuthController({
        service: staffAuth,
        population: "staff",
        refreshTtlSec: config.auth.refreshTtlSec,
      }),
      userAuth: createAuthController({
        service: userAuth,
        population: "user",
        refreshTtlSec: config.auth.refreshTtlSec,
      }),
      staff: createStaffController(staffService),
      users: createUsersController(usersService),
      // The same service behind a second controller: `/api/v1/user/profile`
      // exposes only the functions that read their subject from
      // `ctx.principal`, so the admin handlers are not reachable from the user
      // segment even by a routing mistake (ADR-0019).
      userProfile: createUserProfileController(usersService),
      // The same pairing on the staff side since D2.3: `/api/v1/admin/profile`
      // exposes only the functions that read their subject from
      // `ctx.principal`, so no handler taking an `:id` is reachable from it
      // (ADR-0027).
      staffProfile: createStaffProfileController(staffService),
      // **One** controller for both segments, unlike the profile pairs above:
      // neither of its handlers takes an id, so there is nothing a second
      // factory would withhold from the other mount (ADR-0045).
      settings: createSettingsController(settingsService),
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
