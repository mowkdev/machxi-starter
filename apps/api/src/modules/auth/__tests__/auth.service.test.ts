import type { Population, TokenPurpose } from "@repo/contracts";
import type { PasswordHasher } from "@repo/crypto";
import { sha256Base64url } from "@repo/crypto";
import { createLogger } from "@repo/logger";
import { beforeEach, describe, expect, it } from "vitest";

import type { Audit, AuditEntry } from "../../../core/audit/index.js";
import {
  createRequestContext,
  type Principal,
  type RequestContext,
} from "../../../core/context/index.js";
import {
  createMailTemplates,
  type MailMessage,
  type MailSender,
} from "../../../core/mail/index.js";
import type { AccountTokens } from "../../../core/tokens/index.js";
import { createHashLimiter } from "../auth.hash-limiter.js";
import type {
  EndedImpersonation,
  NewSessionInput,
  RevokeAllImpersonatedByInput,
  RevokeAllInput,
  RevokeBeyondCapInput,
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
/** `IMPERSONATION_SESSION_TTL`, and deliberately unlike the two above (ADR-0057 §4). */
const IMPERSONATION_TTL_SEC = 1800;
/**
 * `AUTH_MAX_SESSIONS_PER_PRINCIPAL` (ADR-0073 §3) — the schema's own default.
 *
 * High enough that no flow in this file reaches it: what the cap does at its
 * edge is `auth-sessions.int.test.ts`'s subject, against a real table with a
 * real `created_at`, and what belongs here is that an ordinary mint is
 * unchanged by its presence.
 */
const MAX_SESSIONS_PER_PRINCIPAL = 10;

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
        impersonatedByStaffId: input.impersonatedByStaffId ?? null,
      };

      rows.set(row.id, row);

      return Promise.resolve(row);
    },

    findById: (id: string) => Promise.resolve(rows.get(id)),

    /*
     * No account in this file holds a federated identity, so no reset here
     * reads when its asking session began; the session-minted consume is
     * proved against Postgres (`federated-identity.int.test.ts`).
     */
    findStartedAt: () => Promise.resolve(undefined),

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
          row.revokedAt === null &&
          row.id !== input.exceptSessionId
        ) {
          rows.set(row.id, { ...row, revokedAt: input.at });
          revoked += 1;
        }
      }

      return Promise.resolve(revoked);
    },

    /**
     * The second revocation predicate (ADR-0057 §6): the rows a staff member
     * is *impersonating through*, which the one above cannot see because they
     * carry a customer's `principal_id` and the `user` population.
     */
    revokeAllImpersonatedBy: (input: RevokeAllImpersonatedByInput) => {
      const ended: EndedImpersonation[] = [];

      for (const row of rows.values()) {
        if (
          row.impersonatedByStaffId === input.staffId &&
          row.revokedAt === null
        ) {
          rows.set(row.id, { ...row, revokedAt: input.at });
          ended.push({ id: row.id, principalId: row.principalId });
        }
      }

      return Promise.resolve(ended);
    },

    /**
     * The per-principal cap (ADR-0073 §3), reproducing the three properties
     * the service leans on: oldest first, an impersonated row counted and
     * never chosen, and the session just minted never chosen.
     *
     * "Oldest" is insertion order here, which the `Map` preserves and the
     * sequential ids make visible; the real repository orders by `created_at`.
     */
    revokeOldestBeyondCap: (input: RevokeBeyondCapInput) => {
      if (input.max <= 0) return Promise.resolve(0);

      const live = [...rows.values()].filter(
        (row) =>
          row.principalType === input.principalType &&
          row.principalId === input.principalId &&
          row.revokedAt === null &&
          row.refreshTokenExpiresAt > input.at,
      );

      const excess = live.length - input.max;

      if (excess <= 0) return Promise.resolve(0);

      const doomed = live
        .filter(
          (row) =>
            row.id !== input.exceptSessionId &&
            row.impersonatedByStaffId === null,
        )
        .slice(0, excess);

      for (const row of doomed) {
        rows.set(row.id, { ...row, revokedAt: input.at });
      }

      return Promise.resolve(doomed.length);
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
  /**
   * `pending_verification`, as the adapter reports it (ADR-0071 §3).
   *
   * A separate flag rather than a status string for the reason the real
   * adapter reports a boolean: which enum values mean what is the population's
   * business, and the service only ever asks "is this account inactive
   * *because its address is unproven*?".
   */
  pending?: boolean;
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
    awaitingEmailVerification: row.pending === true,
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
    /**
     * Active rows only, as both real queries are (ADR-0071 §4).
     *
     * The narrowing is the thing worth reproducing here: `forgot` mails
     * nobody whose address is unproven or whose account is disabled, and a
     * fake that answered every row would let that regression pass.
     */
    findActiveByEmail: (email) => {
      const row = [...rows.values()].find(
        (candidate) => candidate.email === email && candidate.active,
      );

      return Promise.resolve(
        row === undefined ? undefined : { id: row.id, email: row.email },
      );
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
              // Inactive and pending, exactly as the real user adapter writes
              // it: registration proves nothing about the mailbox
              // (ADR-0071 §3).
              active: false,
              pending: true,
            };

            rows.set(row.id, row);

            return Promise.resolve(toRecord(row));
          },

          activateVerified: (id) => {
            const row = rows.get(id);

            // The real statement matches `status = 'pending_verification'`
            // inside the update, so anything else moves no row at all.
            if (row === undefined || row.pending !== true) {
              return Promise.resolve(undefined);
            }

            const activated: FakePrincipal = {
              ...row,
              active: true,
              pending: false,
            };

            rows.set(id, activated);

            return Promise.resolve(toRecord(activated));
          },

          findPendingVerificationByEmail: (email) => {
            const row = [...rows.values()].find(
              (candidate) =>
                candidate.email === email && candidate.pending === true,
            );

            return Promise.resolve(
              row === undefined ? undefined : { id: row.id, email: row.email },
            );
          },
        }
      : {}),
  };

  return { adapter, rows, events } as const;
};

/**
 * The audit writer, recording rather than inserting (ADR-0058).
 *
 * Only one event reaches it from this service — `impersonation.ended` on the
 * exit — and what a unit test can prove about it is the pair of identities and
 * the discipline: `record` is awaited, so a rejecting writer must fail the
 * logout it belongs to.
 */
const createFakeAudit = () => {
  const entries: AuditEntry[] = [];
  let fail: Error | undefined;

  const audit: Audit = {
    record: (_ctx, entry) => {
      if (fail !== undefined) return Promise.reject(fail);

      entries.push(entry);

      return Promise.resolve();
    },
    trail: (_ctx, entry) => {
      entries.push(entry);
    },
  };

  return {
    audit,
    entries,
    failWith: (error: Error) => {
      fail = error;
    },
  } as const;
};

/**
 * ADR-0071 §1's mechanism, as a plain object (ADR-0021).
 *
 * What a fake can prove here is what the *service* does with it — which
 * purpose and which population it names, that a refused consume rolls nothing
 * back because the service throws, and that the raw token reaches the template
 * and nowhere else. Single use, supersession and the transaction's atomicity
 * are properties of one SQL statement and are proved in
 * `apps/api/test/account-tokens.int.test.ts` (`D18.2`).
 */
const createFakeAccountTokens = () => {
  const minted: {
    token: string;
    purpose: TokenPurpose;
    principalType: Population;
    principalId: string;
    consumed: boolean;
  }[] = [];
  let sequence = 0;

  const tokens: AccountTokens = {
    mint: (_ctx, { purpose, principal }) => {
      sequence += 1;
      const token = `account-token-${String(sequence)}`;

      // The real mint supersedes the live row for the pair, so the fake does
      // too: a test that pressed resend twice must not find two live links.
      for (const row of minted) {
        if (
          row.purpose === purpose &&
          row.principalType === principal.type &&
          row.principalId === principal.id
        ) {
          row.consumed = true;
        }
      }

      minted.push({
        token,
        purpose,
        principalType: principal.type,
        principalId: principal.id,
        consumed: false,
      });

      return Promise.resolve({
        token,
        expiresAt: new Date(clock.getTime() + 86_400_000),
      });
    },
    consume: (_ctx, { purpose, principalType, token }) => {
      const row = minted.find(
        (candidate) =>
          candidate.token === token &&
          candidate.purpose === purpose &&
          candidate.principalType === principalType &&
          !candidate.consumed,
      );

      if (row === undefined) return Promise.resolve(undefined);

      row.consumed = true;

      return Promise.resolve({
        id: `token-row-${row.token}`,
        purpose: row.purpose,
        principalType: row.principalType,
        principalId: row.principalId,
        payload: null,
        expiresAt: new Date(clock.getTime() + 86_400_000),
        consumedAt: new Date(clock),
      });
    },
    /** The mint's side effect without a replacement (`D18.9`). */
    supersede: (_ctx, { purpose, principal }) => {
      let superseded = 0;

      for (const row of minted) {
        if (
          row.purpose === purpose &&
          row.principalType === principal.type &&
          row.principalId === principal.id &&
          !row.consumed
        ) {
          row.consumed = true;
          superseded += 1;
        }
      }

      return Promise.resolve(superseded);
    },
  };

  return { tokens, minted } as const;
};

/** The ADR-0066 §1 port, capturing rather than sending. */
const createFakeMail = () => {
  const sent: MailMessage[] = [];
  let fail: Error | undefined;

  const mail: MailSender = {
    send: (_ctx, message) => {
      if (fail !== undefined) return Promise.reject(fail);

      sent.push(message);

      return Promise.resolve();
    },
  };

  return {
    mail,
    sent,
    failWith: (error: Error) => {
      fail = error;
    },
  } as const;
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
    /**
     * The staff adapter the **user** service is wired with (ADR-0057 §4).
     *
     * Absent, the service has no way to look a staff member up at all, which
     * is exactly how the container builds the staff-population instance — so
     * `build()` with no `impersonators` is the wiring that must refuse to
     * issue an impersonated session.
     */
    readonly impersonators?: FakePrincipal[];
  } = {},
) => {
  const population = options.population ?? "staff";
  const sessions = createFakeSessions();
  const audit = createFakeAudit();
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

  const impersonators =
    options.impersonators === undefined
      ? undefined
      : createFakePrincipals("staff", options.impersonators, {
          canCreate: false,
        });

  /**
   * The organizations service narrowed to the one function `register` calls
   * (ADR-0067 §2), as a plain object that records who it was asked about.
   *
   * Wired whenever the adapter can create — the container's own pairing, where
   * the population that self-registers is the one that gets an organizations
   * service — so that `build({ canCreate: false })` still exercises the
   * refusal it was written for.
   */
  const organizations = {
    ensured: [] as string[],
    service: {
      ensurePersonalOrganizationFor: (
        _ctx: RequestContext,
        owner: { readonly id: string },
      ) => {
        organizations.ensured.push(owner.id);

        return Promise.resolve(`org-${owner.id}`);
      },
    },
  };

  const accountTokens = createFakeAccountTokens();
  const mail = createFakeMail();
  // The **real** templates, on two origins a test can recognise: the link is
  // the thing worth asserting, and a fake template would assert itself.
  const mailTemplates = createMailTemplates({
    customerUrl: "https://app.example.test",
    adminUrl: "https://admin.example.test",
  });

  let tokenSequence = 0;

  const service = createAuthService({
    population,
    principals: principals.adapter,
    ...(options.canCreate === true
      ? { organizations: organizations.service }
      : {}),
    ...(impersonators === undefined
      ? {}
      : { impersonators: impersonators.adapter }),
    sessions: sessions.repository,
    audit: audit.audit,
    hasher: hasher.hasher,
    tokens: createTokenService({
      secret: "unit-test-signing-key-at-least-32-characters",
      appId: "machxi",
      issuer: "machxi-api-test",
      accessTtlSec: 900,
      now,
    }),
    hashLimiter: createHashLimiter({ maxConcurrent: 4 }),
    refreshTtlSec: REFRESH_TTL_SEC,
    rotationGraceSec: GRACE_SEC,
    maxSessionsPerPrincipal: MAX_SESSIONS_PER_PRINCIPAL,
    impersonationSessionTtlSec: IMPERSONATION_TTL_SEC,
    accountTokens: accountTokens.tokens,
    mail: mail.mail,
    mailTemplates,
    // No real transaction: the fakes have no atomicity to lose, and what the
    // integration suite proves is that the real one commits together.
    transaction: (fn) => fn(undefined as never),
    now,
    newRefreshToken: () => {
      tokenSequence += 1;

      return `refresh-token-${String(tokenSequence)}`;
    },
  });

  return {
    service,
    sessions,
    audit,
    hasher,
    principals,
    impersonators,
    organizations,
    accountTokens,
    mail,
  } as const;
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

    expect(session?.refreshTokenHash).toBe(sha256Base64url(auth.refreshToken));
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
      refreshToken: first.refreshToken,
    });

    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.principal).toMatchObject({ id: STAFF_ID });

    // Replaying the first token is now outside the grace window: reuse.
    advance(GRACE_SEC + 1);

    await expect(
      harness.service.refresh(context(), {
        refreshToken: first.refreshToken,
      }),
    ).rejects.toMatchObject({ code: "AUTH_REFRESH_REUSED" });
  });

  it("slides the refresh expiry forward", async () => {
    const harness = build();
    const first = await login(harness, "correct-horse-battery");

    advance(600);

    const second = await harness.service.refresh(context(), {
      refreshToken: first.refreshToken,
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
      refreshToken: first.refreshToken,
    });

    advance(GRACE_SEC - 1);

    const retry = await harness.service.refresh(context(), {
      refreshToken: first.refreshToken,
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
      refreshToken: first.refreshToken,
    });

    advance(GRACE_SEC + 1);

    await expect(
      harness.service.refresh(context(), {
        refreshToken: first.refreshToken,
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
      refreshToken: first.refreshToken,
    });
    await harness.service.logout(context(principalOf("session-1")));

    advance(GRACE_SEC + 1);

    await expect(
      harness.service.refresh(context(), {
        refreshToken: first.refreshToken,
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
      refreshToken: first.refreshToken,
    });

    const userService = createAuthService({
      population: "user",
      principals: staffHarness.principals.adapter,
      sessions: staffHarness.sessions.repository,
      audit: staffHarness.audit.audit,
      hasher: staffHarness.hasher.hasher,
      tokens: createTokenService({
        secret: "unit-test-signing-key-at-least-32-characters",
        appId: "machxi",
        issuer: "machxi-api-test",
        accessTtlSec: 900,
        now,
      }),
      hashLimiter: createHashLimiter({ maxConcurrent: 4 }),
      refreshTtlSec: REFRESH_TTL_SEC,
      rotationGraceSec: GRACE_SEC,
      maxSessionsPerPrincipal: MAX_SESSIONS_PER_PRINCIPAL,
      impersonationSessionTtlSec: IMPERSONATION_TTL_SEC,
      // Neither of the flows under test here mints or mails anything;
      // the dependencies are required so a wiring mistake cannot be silent.
      accountTokens: createFakeAccountTokens().tokens,
      mail: createFakeMail().mail,
      mailTemplates: createMailTemplates({
        customerUrl: "https://app.example.test",
        adminUrl: "https://admin.example.test",
      }),
      transaction: (fn) => fn(undefined as never),
      now,
    });

    advance(GRACE_SEC + 1);

    await expect(
      userService.refresh(context(), { refreshToken: first.refreshToken }),
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
        refreshToken: auth.refreshToken,
      }),
    ).rejects.toMatchObject({ code: "AUTH_SESSION_REVOKED" });
  });

  it("refuses an expired session", async () => {
    const harness = build();
    const auth = await login(harness, "correct-horse-battery");

    advance(REFRESH_TTL_SEC + 1);

    await expect(
      harness.service.refresh(context(), {
        refreshToken: auth.refreshToken,
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
      audit: staffHarness.audit.audit,
      hasher: staffHarness.hasher.hasher,
      tokens: createTokenService({
        secret: "unit-test-signing-key-at-least-32-characters",
        appId: "machxi",
        issuer: "machxi-api-test",
        accessTtlSec: 900,
        now,
      }),
      hashLimiter: createHashLimiter({ maxConcurrent: 4 }),
      refreshTtlSec: REFRESH_TTL_SEC,
      rotationGraceSec: GRACE_SEC,
      maxSessionsPerPrincipal: MAX_SESSIONS_PER_PRINCIPAL,
      impersonationSessionTtlSec: IMPERSONATION_TTL_SEC,
      // Neither of the flows under test here mints or mails anything;
      // the dependencies are required so a wiring mistake cannot be silent.
      accountTokens: createFakeAccountTokens().tokens,
      mail: createFakeMail().mail,
      mailTemplates: createMailTemplates({
        customerUrl: "https://app.example.test",
        adminUrl: "https://admin.example.test",
      }),
      transaction: (fn) => fn(undefined as never),
      now,
    });

    await expect(
      userService.refresh(context(), { refreshToken: auth.refreshToken }),
    ).rejects.toMatchObject({ code: "AUTH_INVALID_REFRESH_TOKEN" });
  });

  it("revokes every session when the account is no longer active", async () => {
    const harness = build();
    const auth = await login(harness, "correct-horse-battery");
    const row = harness.principals.rows.get(STAFF_ID);

    if (row !== undefined) row.active = false;

    await expect(
      harness.service.refresh(context(), {
        refreshToken: auth.refreshToken,
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
        refreshToken: auth.refreshToken,
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

  it("creates a pending account, mails the link, and issues no session", async () => {
    // ADR-0071 §3's whole delta on ADR-0018: the account exists and cannot be
    // signed into, and the link is what changes that.
    const harness = build({
      population: "user",
      principals: [],
      canCreate: true,
    });

    await expect(
      harness.service.register(context(), body),
    ).resolves.toBeUndefined();

    const [created] = [...harness.principals.rows.values()];

    expect(created?.active, "no session, and no active account").toBe(false);
    expect(created?.pending).toBe(true);
    expect(harness.sessions.rows.size).toBe(0);
    // The first of the three paths that bring a user into existence, so it
    // creates the personal organization too (ADR-0067 §2). That the two are
    // one *commit* is `auth-register.int.test.ts`'s claim, not this one's.
    expect(harness.organizations.ensured).toEqual([created?.id]);
  });

  it("mints one `verify_email` token and puts it in the link's fragment", async () => {
    const harness = build({
      population: "user",
      principals: [],
      canCreate: true,
    });

    await harness.service.register(context(), body);

    expect(harness.accountTokens.minted).toHaveLength(1);
    expect(harness.accountTokens.minted[0]).toMatchObject({
      purpose: "verify_email",
      principalType: "user",
    });

    const [message] = harness.mail.sent;
    const token = harness.accountTokens.minted[0]?.token ?? "";

    expect(message?.to).toBe("new@machxi.local");
    // The credential travels in the fragment and nowhere else (ADR-0057 §2 as
    // ADR-0071 §1 inherits it). `templates.test.ts` asserts the shape for
    // every template; this asserts that *this* flow uses one.
    expect(message?.text).toContain(
      `https://app.example.test/verify-email#token=${token}`,
    );
    expect(message?.text.split("#token=")[0]).not.toContain(token);
  });

  it("answers even when the transport is broken, leaving the account behind", async () => {
    // The account is already committed by the time the message goes out, so a
    // rethrow would answer 500 for work that succeeded — and the retry would
    // meet the 409 the first attempt created, with no way out. The remedy is
    // `resend-verification`, which is a button, and it needs the account to
    // still be there. The `error` line the failure writes is the operational
    // half and is not asserted here: the harness logger is silent by design
    // (`context()`), and what this case is about is that the request survives.
    const harness = build({
      population: "user",
      principals: [],
      canCreate: true,
    });

    harness.mail.failWith(new Error("smtp refused the connection"));

    await expect(
      harness.service.register(context(), body),
    ).resolves.toBeUndefined();
    expect(harness.principals.rows.size).toBe(1);
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
    // Nothing minted and nothing mailed: a message to an address that already
    // has an account would tell whoever holds it that somebody tried.
    expect(harness.accountTokens.minted).toHaveLength(0);
    expect(harness.mail.sent).toHaveLength(0);
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

/* ── address verification (ADR-0071 §3) ───────────────────────────────────── */

const PENDING_ID = "22222222-2222-7222-8222-222222222222";

/** A `user` service holding one account that has not proven its address. */
const buildPending = () =>
  build({
    population: "user",
    canCreate: true,
    principals: [
      {
        id: PENDING_ID,
        email: "pending@machxi.local",
        passwordHash: "hashed:correct-horse-battery",
        active: false,
        pending: true,
      },
    ],
  });

describe("login on an account whose address is unproven", () => {
  const attempt = (harness: ReturnType<typeof build>, password: string) =>
    harness.service.login(context(), {
      email: "pending@machxi.local",
      password,
    });

  it("answers 403 AUTH_EMAIL_UNVERIFIED for the right password", async () => {
    // Distinguishable from `AUTH_ACCOUNT_DISABLED` on purpose, and only
    // reachable once the password has verified: the caller has already proven
    // they hold the account, so ADR-0020 §Enumeration has nothing left to
    // protect and the client can offer to send the link again.
    await expect(
      attempt(buildPending(), "correct-horse-battery"),
    ).rejects.toMatchObject({ status: 403, code: "AUTH_EMAIL_UNVERIFIED" });
  });

  it("answers 401 AUTH_INVALID_CREDENTIALS for the wrong one", async () => {
    // The status check never runs, so an unverified account is indistinguishable
    // from an unknown address to anyone who does not hold the password.
    await expect(
      attempt(buildPending(), "not-the-password"),
    ).rejects.toMatchObject({ status: 401, code: "AUTH_INVALID_CREDENTIALS" });
  });

  it("keeps AUTH_ACCOUNT_DISABLED for an account that is merely disabled", async () => {
    const harness = build({
      population: "user",
      canCreate: true,
      principals: [
        {
          id: PENDING_ID,
          email: "pending@machxi.local",
          passwordHash: "hashed:correct-horse-battery",
          active: false,
        },
      ],
    });

    await expect(
      attempt(harness, "correct-horse-battery"),
    ).rejects.toMatchObject({ status: 403, code: "AUTH_ACCOUNT_DISABLED" });
  });
});

describe("verifyEmail", () => {
  const linkFor = async (harness: ReturnType<typeof build>) => {
    await harness.service.resendVerification(context(), {
      email: "pending@machxi.local",
    });

    return harness.accountTokens.minted.at(-1)?.token ?? "";
  };

  it("activates the account, stamps the audit row and signs the device in", async () => {
    const harness = buildPending();
    const token = await linkFor(harness);

    const auth = await harness.service.verifyEmail(context(), { token });

    expect(auth.principal).toMatchObject({
      kind: "user",
      id: PENDING_ID,
      email: "pending@machxi.local",
    });
    expect(auth.accessToken).toBeTruthy();
    expect(harness.principals.rows.get(PENDING_ID)?.active).toBe(true);
    expect(harness.sessions.rows.size).toBe(1);
    // Attributed from the claimed row, because the route is anonymous and the
    // context carries no principal to derive from (ADR-0058).
    expect(harness.audit.entries).toContainEqual(
      expect.objectContaining({
        event: "account.verified",
        identities: { actor: { type: "user", id: PENDING_ID } },
      }),
    );
  });

  it("refuses a second redemption of the same link", async () => {
    const harness = buildPending();
    const token = await linkFor(harness);

    await harness.service.verifyEmail(context(), { token });

    await expect(
      harness.service.verifyEmail(context(), { token }),
    ).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    expect(harness.sessions.rows.size).toBe(1);
  });

  it("refuses an unknown token with the same answer", async () => {
    // Unknown, consumed, expired, of another purpose or another population —
    // one answer, because the caller is an anonymous holder of a URL fragment.
    await expect(
      buildPending().service.verifyEmail(context(), {
        token: "nothing-minted",
      }),
    ).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  });

  it("refuses a live token whose account can no longer be activated", async () => {
    // The account was disabled between the mint and the click. The refusal is
    // what rolls the claim back, so the link is spent only by a redemption
    // that actually moved the row (ADR-0071 §1).
    const harness = buildPending();
    const token = await linkFor(harness);
    const row = harness.principals.rows.get(PENDING_ID);

    if (row !== undefined) row.pending = false;

    await expect(
      harness.service.verifyEmail(context(), { token }),
    ).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    expect(harness.sessions.rows.size).toBe(0);
  });
});

describe("resendVerification", () => {
  it("mails the link to an account that is waiting", async () => {
    const harness = buildPending();

    await harness.service.resendVerification(context(), {
      email: "pending@machxi.local",
    });

    expect(harness.mail.sent).toHaveLength(1);
    expect(harness.mail.sent[0]?.to).toBe("pending@machxi.local");
  });

  it("resolves and mails nothing for an address nobody holds", async () => {
    // The whole point: an unknown address and a pending one are one answer,
    // and the only difference is a message in a mailbox the caller has to own.
    const harness = buildPending();

    await expect(
      harness.service.resendVerification(context(), {
        email: "stranger@machxi.local",
      }),
    ).resolves.toBeUndefined();
    expect(harness.mail.sent).toHaveLength(0);
    expect(harness.accountTokens.minted).toHaveLength(0);
  });

  it("resolves and mails nothing for an account that is already active", async () => {
    const harness = build({
      population: "user",
      canCreate: true,
      principals: [
        {
          id: PENDING_ID,
          email: "pending@machxi.local",
          passwordHash: "hashed:correct-horse-battery",
          active: true,
        },
      ],
    });

    await expect(
      harness.service.resendVerification(context(), {
        email: "pending@machxi.local",
      }),
    ).resolves.toBeUndefined();
    expect(harness.mail.sent).toHaveLength(0);
  });

  it("leaves one working link however many times it is pressed", async () => {
    // The mint supersedes the live row for the pair (ADR-0071 §1), so the
    // first link is dead by the time the second arrives.
    const harness = buildPending();

    await harness.service.resendVerification(context(), {
      email: "pending@machxi.local",
    });

    const first = harness.accountTokens.minted.at(-1)?.token ?? "";

    await harness.service.resendVerification(context(), {
      email: "pending@machxi.local",
    });

    const second = harness.accountTokens.minted.at(-1)?.token ?? "";

    expect(second).not.toBe(first);
    await expect(
      harness.service.verifyEmail(context(), { token: first }),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      harness.service.verifyEmail(context(), { token: second }),
    ).resolves.toMatchObject({ principal: { id: PENDING_ID } });
  });
});

/* ── impersonation (ADR-0057 §4) ──────────────────────────────────────────── */

const CUSTOMER_ID = "33333333-3333-7333-8333-333333333333";
const ACTOR_ID = "44444444-4444-7444-8444-444444444444";

/**
 * A `user` service wired the way the container wires it: the customer
 * population's principals, and the staff adapter as `impersonators`.
 */
const buildImpersonation = (
  overrides: {
    readonly targetActive?: boolean;
    readonly actorActive?: boolean;
    readonly actors?: FakePrincipal[];
  } = {},
) =>
  build({
    population: "user",
    principals: [
      {
        id: CUSTOMER_ID,
        email: "customer@machxi.local",
        passwordHash: "hashed:correct-horse-battery",
        active: overrides.targetActive ?? true,
      },
    ],
    impersonators: overrides.actors ?? [
      {
        id: ACTOR_ID,
        email: "operator@machxi.local",
        passwordHash: "hashed:correct-horse-battery",
        active: overrides.actorActive ?? true,
      },
    ],
  });

const openImpersonated = (harness: ReturnType<typeof build>) =>
  harness.service.issueImpersonatedSession(context(), {
    principalId: CUSTOMER_ID,
    staffId: ACTOR_ID,
  });

describe("issueImpersonatedSession", () => {
  it("anchors a fixed end at the exchange, not the sliding refresh TTL", async () => {
    // The delta ADR-0057 §4 makes to ADR-0018, at the instant it is made.
    // `IMPERSONATION_TTL_SEC` is deliberately unlike `REFRESH_TTL_SEC`, so an
    // implementation that reached for the wrong constant fails here.
    const auth = await openImpersonated(buildImpersonation());

    expect(auth.refreshTokenExpiresAt).toBe("2026-08-18T12:30:00.000Z");
  });

  it("marks the session with its actor and names both identities on the wire", async () => {
    const harness = buildImpersonation();
    const auth = await openImpersonated(harness);
    const [session] = [...harness.sessions.rows.values()];

    expect(session?.impersonatedByStaffId).toBe(ACTOR_ID);
    expect(auth.principal).toMatchObject({
      kind: "user",
      id: CUSTOMER_ID,
      impersonatedBy: { id: ACTOR_ID, email: "operator@machxi.local" },
    });
  });

  it("caps the access token at the session's end", async () => {
    // No JWT outlives the session it names (ADR-0057 §4). The cap only bites
    // late in the window — the access TTL is 15 minutes and the session 30 —
    // so the moment worth testing is a rotation 20 minutes in, where an
    // uncapped token would run 5 minutes past a session nobody is
    // impersonating through any more.
    const harness = buildImpersonation();
    const opened = await openImpersonated(harness);

    expect(opened.accessTokenExpiresAt).toBe("2026-08-18T12:15:00.000Z");

    advance(20 * 60);

    const rotated = await harness.service.refresh(context(), {
      refreshToken: opened.refreshToken,
    });

    expect(rotated.accessTokenExpiresAt).toBe(rotated.refreshTokenExpiresAt);
    expect(rotated.accessTokenExpiresAt).toBe("2026-08-18T12:30:00.000Z");
  });

  it("refuses when the minting staff member is gone", async () => {
    // The exchange's judgement, and deliberately not refresh's: a session
    // whose actor cannot be resolved is one the banner could never name, and
    // ADR-0057 §7 makes that banner unremovable.
    const harness = buildImpersonation({ actors: [] });

    await expect(openImpersonated(harness)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(harness.sessions.rows.size).toBe(0);
  });

  it("refuses when the minting staff member is inactive", async () => {
    const harness = buildImpersonation({ actorActive: false });

    await expect(openImpersonated(harness)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(harness.sessions.rows.size).toBe(0);
  });

  it("refuses when the target went inactive after the mint", async () => {
    // A minute passes between the mint and the exchange at most, and "the
    // account was disabled in that minute" must not open anyway.
    const harness = buildImpersonation({ targetActive: false });

    await expect(openImpersonated(harness)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(harness.sessions.rows.size).toBe(0);
  });

  it("refuses on a service with no staff adapter at all", async () => {
    // The staff population's instance, which the container builds without
    // `impersonators` on purpose: a staff session is never impersonated, and
    // this is what makes that a property of the wiring (ADR-0057 §4).
    const harness = build({
      population: "user",
      principals: [
        {
          id: CUSTOMER_ID,
          email: "customer@machxi.local",
          passwordHash: "hashed:correct-horse-battery",
          active: true,
        },
      ],
    });

    await expect(openImpersonated(harness)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });
});

describe("refreshing an impersonated session", () => {
  it("rotates the pair without moving the end", async () => {
    const harness = buildImpersonation();
    const opened = await openImpersonated(harness);

    advance(60);

    const rotated = await harness.service.refresh(context(), {
      refreshToken: opened.refreshToken,
    });

    expect(rotated.refreshTokenExpiresAt).toBe(opened.refreshTokenExpiresAt);
    expect(rotated.refreshToken).not.toBe(opened.refreshToken);
    expect(rotated.principal).toMatchObject({
      impersonatedBy: { id: ACTOR_ID },
    });
  });

  it("still dies at that end, however many times it rotated", async () => {
    const harness = buildImpersonation();
    const opened = await openImpersonated(harness);

    advance(IMPERSONATION_TTL_SEC + 1);

    await expect(
      harness.service.refresh(context(), {
        refreshToken: opened.refreshToken,
      }),
    ).rejects.toMatchObject({ code: "AUTH_INVALID_REFRESH_TOKEN" });
  });

  it("leaves an ordinary session's expiry sliding", async () => {
    // The supersession's terms: every ADR-0018 behaviour outside the two named
    // deltas must show no diff, and this is the one the delta sits next to.
    const harness = build();
    const opened = await login(harness, "correct-horse-battery");

    advance(60);

    const rotated = await harness.service.refresh(context(), {
      refreshToken: opened.refreshToken,
    });

    expect(rotated.refreshTokenExpiresAt).toBe("2026-08-18T13:01:00.000Z");
    expect(opened.refreshTokenExpiresAt).toBe("2026-08-18T13:00:00.000Z");
  });
});

describe("ending an impersonated session", () => {
  /** The principal `authenticate` builds from an impersonated access token. */
  const impersonatedPrincipal = (sessionId: string): Principal => ({
    kind: "user",
    id: CUSTOMER_ID,
    roles: ["customer"],
    sessionId,
    impersonatedBy: ACTOR_ID,
  });

  it("revokes with impersonation_ended and audits it, not as an ordinary logout", async () => {
    // The distinction the trail exists for (ADR-0057 §6): "the customer signed
    // out" and "a support operator finished acting as them" are different
    // events, and `logout` is the same endpoint for both.
    const harness = buildImpersonation();

    await openImpersonated(harness);
    await harness.service.logout(context(impersonatedPrincipal("session-1")));

    expect([...harness.sessions.rows.values()][0]?.revokedAt).not.toBeNull();
    expect(harness.audit.entries).toEqual([
      {
        event: "impersonation.ended",
        identities: {
          actor: { type: "staff", id: ACTOR_ID },
          actingAs: { type: "user", id: CUSTOMER_ID },
        },
        data: { sessionId: "session-1", reason: "logout" },
      },
    ]);
  });

  it("names the staff member as the actor, never the customer", async () => {
    // The inversion ADR-0058 warns about: mapping `ctx.principal` onto `actor`
    // compiles, passes, and makes the one query an incident runs return
    // nothing.
    const harness = buildImpersonation();

    await openImpersonated(harness);
    await harness.service.logout(context(impersonatedPrincipal("session-1")));

    expect(harness.audit.entries[0]?.identities?.actor.type).toBe("staff");
  });

  it("does not end the session when the audit row cannot be written", async () => {
    // `record`'s lifecycle discipline (ADR-0058): the revoke and the row share
    // a transaction, so an impersonation cannot end untraceably. The fakes
    // have no atomicity, so what this pins is that the writer is *awaited* and
    // its failure reaches the caller.
    const harness = buildImpersonation();

    await openImpersonated(harness);
    harness.audit.failWith(new Error("audit_events is unreachable"));

    await expect(
      harness.service.logout(context(impersonatedPrincipal("session-1"))),
    ).rejects.toThrow("audit_events is unreachable");
  });

  it("writes nothing and revokes as an ordinary logout on a real session", async () => {
    // The supersession's terms: an ordinary session must show no diff.
    const harness = build();

    await login(harness, "correct-horse-battery");
    await harness.service.logout(context(principalOf("session-1")));

    expect(harness.audit.entries).toEqual([]);
  });
});

describe("revoking a staff member's sessions", () => {
  /**
   * ADR-0057 §6, out of `D13.4`'s `security-reviewer` pass: the sessions a
   * staff member is *impersonating through* are `principal_type = 'user'`
   * rows, so every revocation the API had — disable, delete, forced logout —
   * missed them entirely and left an operator revoked for cause with a
   * full-access customer session.
   */
  it("reaches the impersonated rows the principal predicate cannot see", async () => {
    const harness = buildImpersonation();

    await openImpersonated(harness);

    // The staff-population service over the same session store — which is how
    // the container wires them: one `sessions` repository, two services.
    const staffService = createAuthService({
      population: "staff",
      principals: harness.principals.adapter,
      sessions: harness.sessions.repository,
      audit: harness.audit.audit,
      hasher: harness.hasher.hasher,
      tokens: createTokenService({
        secret: "unit-test-signing-key-at-least-32-characters",
        appId: "machxi",
        issuer: "machxi-api-test",
        accessTtlSec: 900,
        now,
      }),
      hashLimiter: createHashLimiter({ maxConcurrent: 4 }),
      refreshTtlSec: REFRESH_TTL_SEC,
      rotationGraceSec: GRACE_SEC,
      maxSessionsPerPrincipal: MAX_SESSIONS_PER_PRINCIPAL,
      impersonationSessionTtlSec: IMPERSONATION_TTL_SEC,
      // Neither of the flows under test here mints or mails anything;
      // the dependencies are required so a wiring mistake cannot be silent.
      accountTokens: createFakeAccountTokens().tokens,
      mail: createFakeMail().mail,
      mailTemplates: createMailTemplates({
        customerUrl: "https://app.example.test",
        adminUrl: "https://admin.example.test",
      }),
      transaction: (fn) => fn(undefined as never),
      now,
    });

    const revoked = await staffService.revokeSessionsFor(context(), {
      principalId: ACTOR_ID,
      reason: "account_disabled",
    });

    // Zero of the staff member's *own* sessions — they had none — and the
    // impersonated row is gone anyway, which is the property.
    expect(revoked).toBe(0);
    expect([...harness.sessions.rows.values()][0]?.revokedAt).not.toBeNull();

    // And it left a trail. Without this the exit control produced a complete
    // `minted → exchanged → ended` and an operator revoked *for cause* — the
    // case the sweep exists for — produced silence (ADR-0058).
    expect(harness.audit.entries).toEqual([
      {
        event: "impersonation.ended",
        identities: {
          actor: { type: "staff", id: ACTOR_ID },
          actingAs: { type: "user", id: CUSTOMER_ID },
        },
        data: { sessionId: "session-1", reason: "account_disabled" },
      },
    ]);
  });

  it("leaves an ordinary session of the same population alone", async () => {
    // The equality is on `impersonated_by_staff_id`, which is null on every
    // ordinary row, so nothing outside the delta can be reached by it.
    const harness = build({ population: "staff" });

    await login(harness, "correct-horse-battery");

    await harness.service.revokeSessionsFor(context(), {
      principalId: "99999999-9999-7999-8999-999999999999",
      reason: "account_disabled",
    });

    expect([...harness.sessions.rows.values()][0]?.revokedAt).toBeNull();
  });

  it("does not sweep on the user population, where the column is never a subject", async () => {
    const harness = buildImpersonation();

    await openImpersonated(harness);

    // The customer's *own* id, through the user-population service: the
    // impersonated row is that customer's, so the first predicate already
    // matches it and the second never runs.
    const revoked = await harness.service.revokeSessionsFor(context(), {
      principalId: CUSTOMER_ID,
      reason: "logout_all",
    });

    expect(revoked).toBe(1);
  });

  it("still counts and revokes the staff member's own sessions", async () => {
    // The sweep is additive: the number every caller reports is unchanged.
    const harness = build({ population: "staff" });

    await login(harness, "correct-horse-battery");

    const revoked = await harness.service.revokeSessionsFor(context(), {
      principalId: STAFF_ID,
      reason: "admin_revoke",
    });

    expect(revoked).toBe(1);
  });
});
