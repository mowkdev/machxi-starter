import type { AuthResource } from "@repo/contracts";
import type { PasswordHasher } from "@repo/crypto";
import { sha256Base64url } from "@repo/crypto";
import { createLogger } from "@repo/logger";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createRequestContext,
  type Principal,
  type RequestContext,
} from "../../../core/context/index.js";
import { createHashLimiter } from "../auth.hash-limiter.js";
import type {
  NewSessionInput,
  RevokeAllInput,
  RevokeInput,
  RotateSessionInput,
  SessionRecord,
  SessionsRepository,
} from "../auth.repository.js";
import { createAuthService } from "../auth.service.js";
import { createTokenService } from "../auth.tokens.js";
import type { PrincipalAdapter, PrincipalRecord } from "../auth.types.js";

/**
 * The ADR-0018 flows, against fake repositories (ADR-0021 §Unit).
 *
 * No database and no Express: what is under test is the *decision sequence* —
 * which check runs before which, what gets revoked, and which code comes back
 * — and every one of those is a rule the ADR states. `now` is injected, so the
 * rotation grace window and expiry are exercised at exact instants instead of
 * with sleeps.
 */

const STAFF_ID = "11111111-1111-7111-8111-111111111111";
const REFRESH_TTL_SEC = 3600;
const GRACE_SEC = 30;

/* ── clock ────────────────────────────────────────────────────────────────── */

let clock = new Date("2026-08-18T12:00:00.000Z");
const now = () => clock;
const advance = (seconds: number) => {
  clock = new Date(clock.getTime() + seconds * 1000);
};

/* ── fakes ────────────────────────────────────────────────────────────────── */

/**
 * An in-memory `sessions` table.
 *
 * It reproduces the two behaviours the service actually leans on: the unique
 * index on `refresh_token_hash`, and `rotate` matching on the *expected*
 * current hash so a concurrent rotation loses.
 */
const createFakeSessions = () => {
  const rows = new Map<string, SessionRecord>();
  let sequence = 0;

  const repository: SessionsRepository = {
    create: (input: NewSessionInput) => {
      sequence += 1;
      const row: SessionRecord = {
        id: `session-${String(sequence)}`,
        principalType: input.principalType,
        principalId: input.principalId,
        refreshTokenHash: input.refreshTokenHash,
        previousRefreshTokenHash: null,
        refreshTokenExpiresAt: input.refreshTokenExpiresAt,
        rotatedAt: null,
        revokedAt: null,
      };

      rows.set(row.id, row);

      return Promise.resolve(row);
    },

    findById: (id: string) => Promise.resolve(rows.get(id)),

    findByRefreshTokenHash: (hash: string) =>
      Promise.resolve(
        [...rows.values()].find((row) => row.refreshTokenHash === hash),
      ),

    findByPreviousRefreshTokenHash: (hash: string) =>
      Promise.resolve(
        [...rows.values()].find((row) => row.previousRefreshTokenHash === hash),
      ),

    rotate: (input: RotateSessionInput) => {
      const row = rows.get(input.id);

      if (
        row === undefined ||
        row.refreshTokenHash !== input.expectedRefreshTokenHash ||
        row.revokedAt !== null
      ) {
        return Promise.resolve(undefined);
      }

      const next: SessionRecord = {
        ...row,
        refreshTokenHash: input.refreshTokenHash,
        previousRefreshTokenHash: input.expectedRefreshTokenHash,
        refreshTokenExpiresAt: input.refreshTokenExpiresAt,
        rotatedAt: input.at,
      };

      rows.set(row.id, next);

      return Promise.resolve(next);
    },

    revoke: (input: RevokeInput) => {
      const row = rows.get(input.id);

      if (row !== undefined && row.revokedAt === null) {
        rows.set(row.id, { ...row, revokedAt: input.at });
      }

      return Promise.resolve();
    },

    revokeAllForPrincipal: (input: RevokeAllInput) => {
      let revoked = 0;

      for (const row of rows.values()) {
        if (
          row.principalType === input.principalType &&
          row.principalId === input.principalId &&
          row.revokedAt === null
        ) {
          rows.set(row.id, { ...row, revokedAt: input.at });
          revoked += 1;
        }
      }

      return Promise.resolve(revoked);
    },
  };

  return { repository, rows } as const;
};

/**
 * A hasher whose "hash" is the password with a marker prefix.
 *
 * Cheap by design: argon2's correctness is `@repo/crypto`'s to prove (39 tests
 * there), and running the real one here would add ~40 ms to every case for no
 * coverage this file is responsible for. What it *does* reproduce faithfully
 * is `dummyHash()` — a value no password can match — because the equal-timing
 * rule depends on the service asking for one.
 */
const createFakeHasher = () => {
  const calls = { verify: 0, hash: 0, dummy: 0 };
  let needsRehashResult = false;

  const hasher: PasswordHasher = {
    hash: (password) => {
      calls.hash += 1;

      return Promise.resolve(`hashed:${password}`);
    },
    verify: (hash, password) => {
      calls.verify += 1;

      return Promise.resolve(hash === `hashed:${password}`);
    },
    needsRehash: () => needsRehashResult,
    dummyHash: () => {
      calls.dummy += 1;

      // Not of the form `hashed:<password>`, so `verify` can never match it —
      // which is what a real dummy hash guarantees.
      return Promise.resolve("dummy-hash-that-nothing-verifies-against");
    },
  };

  return {
    hasher,
    calls,
    setNeedsRehash: (value: boolean) => {
      needsRehashResult = value;
    },
  } as const;
};

interface FakePrincipal {
  readonly id: string;
  email: string;
  passwordHash: string | null;
  active: boolean;
}

const createFakePrincipals = (
  population: "staff" | "user",
  seed: FakePrincipal[],
  options: { readonly canCreate?: boolean } = {},
) => {
  const rows = new Map(seed.map((row) => [row.id, { ...row }]));
  const events = { touchedLastLogin: 0, passwordHashUpdates: [] as string[] };

  const toRecord = (row: FakePrincipal): PrincipalRecord => ({
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    active: row.active,
    roles: population === "staff" ? ["admin"] : ["customer"],
    resource:
      population === "staff"
        ? {
            kind: "staff",
            id: row.id,
            email: row.email,
            firstName: "Test",
            lastName: "Principal",
            roles: ["admin"],
          }
        : {
            kind: "user",
            id: row.id,
            email: row.email,
            firstName: null,
            lastName: null,
            roles: ["customer"],
          },
  });

  const adapter: PrincipalAdapter = {
    population,
    findByEmail: (email) => {
      const row = [...rows.values()].find(
        (candidate) => candidate.email === email,
      );

      return Promise.resolve(row === undefined ? undefined : toRecord(row));
    },
    findById: (id) => {
      const row = rows.get(id);

      return Promise.resolve(row === undefined ? undefined : toRecord(row));
    },
    touchLastLogin: () => {
      events.touchedLastLogin += 1;

      return Promise.resolve();
    },
    updatePasswordHash: (id, passwordHash) => {
      events.passwordHashUpdates.push(passwordHash);
      const row = rows.get(id);

      if (row !== undefined) rows.set(id, { ...row, passwordHash });

      return Promise.resolve();
    },
    ...(options.canCreate === true
      ? {
          create: (input) => {
            const taken = [...rows.values()].some(
              (row) => row.email === input.email,
            );

            if (taken) return Promise.resolve(undefined);

            const row: FakePrincipal = {
              id: `created-${String(rows.size + 1)}`,
              email: input.email,
              passwordHash: input.passwordHash,
              active: true,
            };

            rows.set(row.id, row);

            return Promise.resolve(toRecord(row));
          },
        }
      : {}),
  };

  return { adapter, rows, events } as const;
};

/* ── harness ──────────────────────────────────────────────────────────────── */

const context = (principal: Principal | null = null): RequestContext => {
  const ctx = createRequestContext({
    requestId: "test-request-id",
    logger: createLogger({ level: "silent" }),
    ip: "203.0.113.7",
    userAgent: "machxi-tests/1.0",
  });

  ctx.principal = principal;

  return ctx;
};

const build = (
  options: {
    readonly population?: "staff" | "user";
    readonly principals?: FakePrincipal[];
    readonly canCreate?: boolean;
  } = {},
) => {
  const population = options.population ?? "staff";
  const sessions = createFakeSessions();
  const hasher = createFakeHasher();
  const principals = createFakePrincipals(
    population,
    options.principals ?? [
      {
        id: STAFF_ID,
        email: "admin@machxi.local",
        passwordHash: "hashed:correct-horse-battery",
        active: true,
      },
    ],
    { canCreate: options.canCreate ?? false },
  );

  let tokenSequence = 0;

  const service = createAuthService({
    population,
    principals: principals.adapter,
    sessions: sessions.repository,
    hasher: hasher.hasher,
    tokens: createTokenService({
      secret: "unit-test-signing-key-at-least-32-characters",
      issuer: "machxi-api-test",
      accessTtlSec: 900,
      now,
    }),
    hashLimiter: createHashLimiter({ maxConcurrent: 4 }),
    refreshTtlSec: REFRESH_TTL_SEC,
    rotationGraceSec: GRACE_SEC,
    // No real transaction: the fakes have no atomicity to lose, and what the
    // integration suite proves is that the real one commits together.
    transaction: (fn) => fn(undefined as never),
    now,
    newRefreshToken: () => {
      tokenSequence += 1;

      return `refresh-token-${String(tokenSequence)}`;
    },
  });

  return { service, sessions, hasher, principals } as const;
};

const login = (harness: ReturnType<typeof build>, password: string) =>
  harness.service.login(context(), {
    email: "admin@machxi.local",
    password,
  });

beforeEach(() => {
  clock = new Date("2026-08-18T12:00:00.000Z");
});

/* ── login ────────────────────────────────────────────────────────────────── */

/**
 * The refresh token of a service response, asserted present.
 *
 * `AuthResource.refreshToken` is optional since ADR-0029 — the **controller**
 * omits it when the client asked for cookie transport — but the service always
 * issues one, and every assertion below rests on that. Narrowing here says so
 * once and fails loudly if it ever stops being true, rather than spreading
 * `?? ""` over twenty call sites and turning a missing token into a passing
 * test.
 */
const refreshTokenOf = (auth: AuthResource): string => {
  if (auth.refreshToken === undefined) {
    throw new Error("the auth service must always issue a refresh token");
  }

  return auth.refreshToken;
};

describe("login", () => {
  it("returns the token pair, the expiries and the principal", async () => {
    const harness = build();
    const auth = await login(harness, "correct-horse-battery");

    expect(auth.tokenType).toBe("Bearer");
    expect(auth.refreshToken).toBe("refresh-token-1");
    expect(auth.accessTokenExpiresAt).toBe("2026-08-18T12:15:00.000Z");
    expect(auth.refreshTokenExpiresAt).toBe("2026-08-18T13:00:00.000Z");
    expect(auth.principal).toMatchObject({ kind: "staff", id: STAFF_ID });
  });

  it("stores only the hash of the refresh token", async () => {
    // A database read must never yield a usable credential (ADR-0018).
    const harness = build();
    const auth = await login(harness, "correct-horse-battery");
    const [session] = [...harness.sessions.rows.values()];

    expect(session?.refreshTokenHash).toBe(
      sha256Base64url(refreshTokenOf(auth)),
    );
    expect(session?.refreshTokenHash).not.toBe(auth.refreshToken);
  });

  it("records the audit trail and the last login", async () => {
    const harness = build();

    await login(harness, "correct-horse-battery");

    expect(harness.principals.events.touchedLastLogin).toBe(1);
    expect(harness.sessions.rows.size).toBe(1);
  });

  it("refuses a wrong password with the generic code", async () => {
    const harness = build();

    await expect(login(harness, "wrong")).rejects.toMatchObject({
      status: 401,
      code: "AUTH_INVALID_CREDENTIALS",
    });
  });

  it("answers an unknown email identically, having verified against a dummy", async () => {
    // Same code, same status — and the same work, so the response time does
    // not answer "does this address exist?" (ADR-0018 §Login step 2).
    const harness = build();

    const failure = await harness.service
      .login(context(), { email: "nobody@machxi.local", password: "whatever" })
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
    expect(harness.hasher.calls.dummy).toBe(1);
    expect(harness.hasher.calls.verify).toBe(1);
  });

  it("treats a null password hash as no password login, not as any password", async () => {
    const harness = build({
      principals: [
        {
          id: STAFF_ID,
          email: "admin@machxi.local",
          passwordHash: null,
          active: true,
        },
      ],
    });

    await expect(login(harness, "anything")).rejects.toMatchObject({
      code: "AUTH_INVALID_CREDENTIALS",
    });
    expect(harness.hasher.calls.dummy).toBe(1);
  });

  it("checks the password before the account status", async () => {
    // Reversing these two would let anyone learn that an address exists and is
    // disabled, without knowing its password.
    const harness = build({
      principals: [
        {
          id: STAFF_ID,
          email: "admin@machxi.local",
          passwordHash: "hashed:correct-horse-battery",
          active: false,
        },
      ],
    });

    await expect(login(harness, "wrong")).rejects.toMatchObject({
      code: "AUTH_INVALID_CREDENTIALS",
    });

    await expect(login(harness, "correct-horse-battery")).rejects.toMatchObject(
      {
        status: 403,
        code: "AUTH_ACCOUNT_DISABLED",
      },
    );
  });

  it("creates no session for a refused login", async () => {
    const harness = build();

    await login(harness, "wrong").catch(() => undefined);

    expect(harness.sessions.rows.size).toBe(0);
  });

  it("upgrades a hash that was made with older parameters", async () => {
    const harness = build();

    harness.hasher.setNeedsRehash(true);
    await login(harness, "correct-horse-battery");

    expect(harness.principals.events.passwordHashUpdates).toEqual([
      "hashed:correct-horse-battery",
    ]);
  });

  it("does not rehash when the parameters already match", async () => {
    const harness = build();

    await login(harness, "correct-horse-battery");

    expect(harness.principals.events.passwordHashUpdates).toEqual([]);
  });
});

/* ── refresh ──────────────────────────────────────────────────────────────── */

describe("refresh", () => {
  it("rotates the pair and kills the token it replaced", async () => {
    const harness = build();
    const first = await login(harness, "correct-horse-battery");

    advance(GRACE_SEC + 1);

    const second = await harness.service.refresh(context(), {
      refreshToken: refreshTokenOf(first),
    });

    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.principal).toMatchObject({ id: STAFF_ID });

    // Replaying the first token is now outside the grace window: reuse.
    advance(GRACE_SEC + 1);

    await expect(
      harness.service.refresh(context(), {
        refreshToken: refreshTokenOf(first),
      }),
    ).rejects.toMatchObject({ code: "AUTH_REFRESH_REUSED" });
  });

  it("slides the refresh expiry forward", async () => {
    const harness = build();
    const first = await login(harness, "correct-horse-battery");

    advance(600);

    const second = await harness.service.refresh(context(), {
      refreshToken: refreshTokenOf(first),
    });

    expect(new Date(second.refreshTokenExpiresAt).getTime()).toBe(
      clock.getTime() + REFRESH_TTL_SEC * 1000,
    );
  });

  it("serves a retry inside the grace window instead of calling it reuse", async () => {
    // Two tabs, or a lost response. Both callers end up with a working pair.
    const harness = build();
    const first = await login(harness, "correct-horse-battery");

    await harness.service.refresh(context(), {
      refreshToken: refreshTokenOf(first),
    });

    advance(GRACE_SEC - 1);

    const retry = await harness.service.refresh(context(), {
      refreshToken: refreshTokenOf(first),
    });

    expect(retry.refreshToken).toBeTruthy();
    expect([...harness.sessions.rows.values()][0]?.revokedAt).toBeNull();
  });

  it("revokes the session when a rotated token is replayed after the window", async () => {
    // The token is assumed stolen: the legitimate holder's session is exactly
    // what an attacker would use next (ADR-0018 §Refresh step 4).
    const harness = build();
    const first = await login(harness, "correct-horse-battery");

    await harness.service.refresh(context(), {
      refreshToken: refreshTokenOf(first),
    });

    advance(GRACE_SEC + 1);

    await expect(
      harness.service.refresh(context(), {
        refreshToken: refreshTokenOf(first),
      }),
    ).rejects.toMatchObject({ status: 401, code: "AUTH_REFRESH_REUSED" });

    expect([...harness.sessions.rows.values()][0]?.revokedAt).not.toBeNull();
  });

  it("treats a stale token from a logged-out session as revoked, not as theft", async () => {
    // The commonest client bug there is: a tab that kept a token across a
    // logout. Logging it as reuse at `warn` would make the signal that is
    // supposed to mean "a token was stolen" mean nothing (ADR-0020 §Audit
    // trail). The check runs before the reuse branch, so nothing is revoked
    // twice either.
    const harness = build();
    const first = await login(harness, "correct-horse-battery");

    await harness.service.refresh(context(), {
      refreshToken: refreshTokenOf(first),
    });
    await harness.service.logout(context(principalOf("session-1")));

    advance(GRACE_SEC + 1);

    await expect(
      harness.service.refresh(context(), {
        refreshToken: refreshTokenOf(first),
      }),
    ).rejects.toMatchObject({ code: "AUTH_SESSION_REVOKED" });
  });

  it("does not revoke another population's session when its rotated token is replayed", async () => {
    // The population check has to run before the reuse branch, because that
    // branch has a side effect: revoking a *user* session from the admin
    // segment is both a distinguishable code and a cross-segment state change
    // (ADR-0019 §1).
    const staffHarness = build({ population: "staff" });
    const first = await login(staffHarness, "correct-horse-battery");

    await staffHarness.service.refresh(context(), {
      refreshToken: refreshTokenOf(first),
    });

    const userService = createAuthService({
      population: "user",
      principals: staffHarness.principals.adapter,
      sessions: staffHarness.sessions.repository,
      hasher: staffHarness.hasher.hasher,
      tokens: createTokenService({
        secret: "unit-test-signing-key-at-least-32-characters",
        issuer: "machxi-api-test",
        accessTtlSec: 900,
        now,
      }),
      hashLimiter: createHashLimiter({ maxConcurrent: 4 }),
      refreshTtlSec: REFRESH_TTL_SEC,
      rotationGraceSec: GRACE_SEC,
      transaction: (fn) => fn(undefined as never),
      now,
    });

    advance(GRACE_SEC + 1);

    await expect(
      userService.refresh(context(), { refreshToken: refreshTokenOf(first) }),
    ).rejects.toMatchObject({ code: "AUTH_INVALID_REFRESH_TOKEN" });

    expect([...staffHarness.sessions.rows.values()][0]?.revokedAt).toBeNull();
  });

  it("refuses an unknown token", async () => {
    const harness = build();

    await expect(
      harness.service.refresh(context(), { refreshToken: "never-issued" }),
    ).rejects.toMatchObject({ code: "AUTH_INVALID_REFRESH_TOKEN" });
  });

  it("refuses a revoked session", async () => {
    const harness = build();
    const auth = await login(harness, "correct-horse-battery");

    await harness.service.logout(
      context({
        kind: "staff",
        id: STAFF_ID,
        roles: ["admin"],
        sessionId: "session-1",
      }),
    );

    await expect(
      harness.service.refresh(context(), {
        refreshToken: refreshTokenOf(auth),
      }),
    ).rejects.toMatchObject({ code: "AUTH_SESSION_REVOKED" });
  });

  it("refuses an expired session", async () => {
    const harness = build();
    const auth = await login(harness, "correct-horse-battery");

    advance(REFRESH_TTL_SEC + 1);

    await expect(
      harness.service.refresh(context(), {
        refreshToken: refreshTokenOf(auth),
      }),
    ).rejects.toMatchObject({ code: "AUTH_INVALID_REFRESH_TOKEN" });
  });

  it("refuses a token belonging to the other population", async () => {
    // Indistinguishable from an unknown token, so the difference cannot be
    // used to probe (ADR-0019).
    const staffHarness = build({ population: "staff" });
    const auth = await login(staffHarness, "correct-horse-battery");

    const userService = createAuthService({
      population: "user",
      principals: staffHarness.principals.adapter,
      // Same store, so the row genuinely exists — only its population differs.
      sessions: staffHarness.sessions.repository,
      hasher: staffHarness.hasher.hasher,
      tokens: createTokenService({
        secret: "unit-test-signing-key-at-least-32-characters",
        issuer: "machxi-api-test",
        accessTtlSec: 900,
        now,
      }),
      hashLimiter: createHashLimiter({ maxConcurrent: 4 }),
      refreshTtlSec: REFRESH_TTL_SEC,
      rotationGraceSec: GRACE_SEC,
      transaction: (fn) => fn(undefined as never),
      now,
    });

    await expect(
      userService.refresh(context(), { refreshToken: refreshTokenOf(auth) }),
    ).rejects.toMatchObject({ code: "AUTH_INVALID_REFRESH_TOKEN" });
  });

  it("revokes every session when the account is no longer active", async () => {
    const harness = build();
    const auth = await login(harness, "correct-horse-battery");
    const row = harness.principals.rows.get(STAFF_ID);

    if (row !== undefined) row.active = false;

    await expect(
      harness.service.refresh(context(), {
        refreshToken: refreshTokenOf(auth),
      }),
    ).rejects.toMatchObject({ status: 403, code: "AUTH_ACCOUNT_DISABLED" });

    expect([...harness.sessions.rows.values()][0]?.revokedAt).not.toBeNull();
  });

  it("revokes the session when the account was deleted outright", async () => {
    // `sessions` has no foreign key to either population, so nothing else
    // cleans this up (ADR-0018).
    const harness = build();
    const auth = await login(harness, "correct-horse-battery");

    harness.principals.rows.delete(STAFF_ID);

    await expect(
      harness.service.refresh(context(), {
        refreshToken: refreshTokenOf(auth),
      }),
    ).rejects.toMatchObject({ code: "AUTH_INVALID_REFRESH_TOKEN" });

    expect([...harness.sessions.rows.values()][0]?.revokedAt).not.toBeNull();
  });
});

/* ── logout, me ───────────────────────────────────────────────────────────── */

const principalOf = (sessionId: string): Principal => ({
  kind: "staff",
  id: STAFF_ID,
  roles: ["admin"],
  sessionId,
});

describe("logout", () => {
  it("revokes only the current session", async () => {
    const harness = build();

    await login(harness, "correct-horse-battery");
    await login(harness, "correct-horse-battery");

    await harness.service.logout(context(principalOf("session-1")));

    const rows = [...harness.sessions.rows.values()];

    expect(rows[0]?.revokedAt).not.toBeNull();
    expect(rows[1]?.revokedAt).toBeNull();
  });

  it("revokes every session on logout-all", async () => {
    const harness = build();

    await login(harness, "correct-horse-battery");
    await login(harness, "correct-horse-battery");

    await harness.service.logoutAll(context(principalOf("session-1")));

    expect(
      [...harness.sessions.rows.values()].every(
        (row) => row.revokedAt !== null,
      ),
    ).toBe(true);
  });

  it("refuses to act without a principal", async () => {
    const harness = build();

    await expect(harness.service.logout(context())).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe("me", () => {
  it("re-reads the principal rather than trusting the token's claims", async () => {
    const harness = build();
    const row = harness.principals.rows.get(STAFF_ID);

    if (row !== undefined) row.email = "renamed@machxi.local";

    await expect(
      harness.service.me(context(principalOf("session-1"))),
    ).resolves.toMatchObject({ email: "renamed@machxi.local" });
  });

  it("revokes the sessions of an account that was disabled mid-token", async () => {
    // Refusing alone would leave the refresh token alive to mint a new access
    // token 15 minutes later.
    const harness = build();

    await login(harness, "correct-horse-battery");

    const row = harness.principals.rows.get(STAFF_ID);

    if (row !== undefined) row.active = false;

    await expect(
      harness.service.me(context(principalOf("session-1"))),
    ).rejects.toMatchObject({ code: "AUTH_SESSION_REVOKED" });

    expect([...harness.sessions.rows.values()][0]?.revokedAt).not.toBeNull();
  });
});

/* ── register ─────────────────────────────────────────────────────────────── */

describe("register", () => {
  const body = {
    email: "new@machxi.local",
    password: "a-long-enough-password",
    firstName: "New",
    lastName: "Person",
  };

  it("creates the account and signs it in", async () => {
    const harness = build({
      population: "user",
      principals: [],
      canCreate: true,
    });

    const auth = await harness.service.register(context(), body);

    expect(auth.principal).toMatchObject({
      kind: "user",
      email: "new@machxi.local",
      roles: ["customer"],
    });
    expect(auth.accessToken).toBeTruthy();
    expect(harness.sessions.rows.size).toBe(1);
  });

  it("answers a taken address with a generic conflict", async () => {
    // Never `USER_EMAIL_TAKEN`: that would make an anonymous endpoint an
    // account-existence oracle (ADR-0020 §Enumeration).
    const harness = build({
      population: "user",
      principals: [
        {
          id: "existing",
          email: "new@machxi.local",
          passwordHash: "hashed:whatever",
          active: true,
        },
      ],
      canCreate: true,
    });

    const failure = await harness.service
      .register(context(), body)
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({ status: 409, code: "CONFLICT" });
    expect(JSON.stringify(failure)).not.toContain("new@machxi.local");
    expect(harness.sessions.rows.size).toBe(0);
  });

  it("refuses outright for a population that cannot self-register", async () => {
    // Staff are created by an admin (ADR-0017 §Invariants). No client can
    // reach this — the public router mounts the user service — so it is a 500.
    const harness = build({ population: "staff" });

    await expect(
      harness.service.register(context(), body),
    ).rejects.toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
  });
});
