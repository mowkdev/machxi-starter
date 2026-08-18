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
  createDbIndicator,
  createHealthController,
  createHealthService,
} from "../modules/health/index.js";
import { createStaffRepository } from "../modules/staff/index.js";
import { createUsersRepository } from "../modules/users/index.js";

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

  // The one place that knows how to open a transaction. Repositories take a
  // `DbExecutor` (ADR-0006), so a service composes them without ever importing
  // the client.
  const transaction = <T>(
    fn: (tx: DbExecutor) => Promise<T>,
  ): Promise<T> => db.db.transaction(fn);

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

  return {
    config,
    db,
    logger,
    hasher,
    authenticate,
    repositories: {
      staff: staffRepository,
      users: usersRepository,
      sessions,
    } as const,
    services: { health, staffAuth, userAuth } as const,
    controllers: {
      health: createHealthController(health),
      staffAuth: createAuthController(staffAuth),
      userAuth: createAuthController(userAuth),
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
