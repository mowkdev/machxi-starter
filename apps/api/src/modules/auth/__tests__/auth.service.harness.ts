import type { Population, TokenPurpose } from "@repo/contracts";
import type { PasswordHasher } from "@repo/crypto";
import { createLogger } from "@repo/logger";

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
 * The fakes and the harness the auth service's unit tests are written against
 * (ADR-0021 §Unit).
 *
 * One file rather than two copies: `auth.service.test.ts` and
 * `auth.mail-flows.service.test.ts` exercise two halves of the same composed
 * service (`D20.7`), and a second copy of the in-memory `sessions` table is a
 * second thing to keep true. Not a `*.test.ts` file, so the unit run's include
 * glob never collects it as a suite with no cases in it.
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
     * the service leans on: oldest first, an impersonated row neither counted
     * nor chosen (ADR-0074 §4), and the session just minted never chosen.
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
          row.refreshTokenExpiresAt > input.at &&
          row.impersonatedByStaffId === null,
      );

      const excess = live.length - input.max;

      if (excess <= 0) return Promise.resolve(0);

      const doomed = live
        .filter((row) => row.id !== input.exceptSessionId)
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
    lockCredentials: () => Promise.resolve(),
    /** Who a live token names; the fake has no locks to take (ADR-0078 §3). */
    lockHolderOf: (_ctx, { purpose, principalType, token }) => {
      const row = minted.find(
        (candidate) =>
          candidate.token === token &&
          candidate.purpose === purpose &&
          candidate.principalType === principalType &&
          !candidate.consumed,
      );

      return Promise.resolve(
        row === undefined
          ? undefined
          : ({ type: row.principalType, id: row.principalId } as const),
      );
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
    /** Every purpose at once (ADR-0074 §5). */
    supersedeAll: (_ctx, principal) => {
      let superseded = 0;

      for (const row of minted) {
        if (
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

/**
 * The instant every case starts from.
 *
 * Exported rather than registered here, so each test file states its own
 * `beforeEach` and nothing is hidden in an import.
 */
export const resetClock = () => {
  clock = new Date("2026-08-18T12:00:00.000Z");
};

export {
  GRACE_SEC,
  IMPERSONATION_TTL_SEC,
  MAX_SESSIONS_PER_PRINCIPAL,
  PENDING_ID,
  REFRESH_TTL_SEC,
  STAFF_ID,
  advance,
  build,
  buildPending,
  clock,
  context,
  createFakeAccountTokens,
  createFakeMail,
  login,
  now,
};
export type { FakePrincipal };
