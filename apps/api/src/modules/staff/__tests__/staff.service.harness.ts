import type { ListStaffQuery, StaffRole, StaffStatus } from "@repo/contracts";
import { createLogger } from "@repo/logger";
import { expect } from "vitest";

import type { Audit, AuditEntry } from "../../../core/audit/index.js";
import type { LimitedHasher } from "../../../core/auth/index.js";
import {
  createRequestContext,
  type Principal,
  type RequestContext,
} from "../../../core/context/index.js";
import { isAppError } from "../../../core/errors/index.js";
import {
  createMailTemplates,
  type MailSender,
} from "../../../core/mail/index.js";
import type { AccountTokens } from "../../../core/tokens/index.js";
import type {
  NewStaffInput,
  StaffColumnPatch,
  StaffRecord,
  StaffRepository,
} from "../staff.repository.js";
import { createStaffService } from "../staff.service.js";

/**
 * The fakes and the harness the staff module's unit suites are built on
 * (ADR-0021 §Unit).
 *
 * Extracted at `D20.7`, when `staff.onboarding.service.test.ts` took the cases
 * for ADR-0071 §8's flow: both suites drive the module through
 * `createStaffService`, so they have to drive it through the same fakes or
 * "the same service" stops being what is under test. Not a `*.test.ts` file,
 * so Vitest does not collect it.
 *
 * No database and no Express. What is under test is the part a guard cannot
 * see: the ADR-0017 invariant that an active `super_admin` survives every
 * edit, and the ADR-0018 rule that disabling an account ends its sessions in
 * the same breath. Everything else here is plumbing that the integration
 * suite exercises for real.
 */

export const SUPER_ADMIN_ID = "11111111-1111-7111-8111-111111111111";
export const ADMIN_ID = "22222222-2222-7222-8222-222222222222";
export const ACTOR_ID = "33333333-3333-7333-8333-333333333333";
/** The `invited` operator ADR-0071 §8's two endpoints act on. */
export const INVITED_ID = "44444444-4444-7444-8444-444444444444";
/**
 * An actor id with hex *letters* in it, for the case-spelling rule below.
 *
 * The other ids in this file are all digits, so `toUpperCase()` on them is a
 * no-op — a test written against one of those would pass whether or not the
 * comparison is case-insensitive, which is how the first attempt at this test
 * proved nothing.
 */
export const MIXED_CASE_ACTOR_ID = "0199a1f4-4c2e-7c53-9c62-3e0f9d0f7f11";
export const NOW = new Date("2026-08-18T12:00:00.000Z");

/* ── fakes ────────────────────────────────────────────────────────────────── */

export interface FakeStaffRow {
  readonly id: string;
  email: string;
  /** Nullable since ADR-0071 §8: an `invited` operator has no password yet. */
  passwordHash: string | null;
  firstName: string;
  lastName: string;
  status: StaffStatus;
  roles: readonly StaffRole[];
}

export const toRecord = (row: FakeStaffRow): StaffRecord => ({
  ...row,
  lastLoginAt: null,
  createdAt: NOW,
  updatedAt: NOW,
});

/**
 * An in-memory `staff` + `staff_roles` pair.
 *
 * It reproduces the two behaviours the service leans on: the unique index on
 * `email`, which is what makes `create` resolve to `undefined` rather than
 * throw, and `countOtherActiveSuperAdmins` excluding the row being edited.
 */
export const createFakeRepository = (seed: FakeStaffRow[]) => {
  const rows = new Map(seed.map((row) => [row.id, { ...row }]));
  const calls = {
    replaceRoles: 0,
    updateColumns: 0,
    updatePasswordHash: 0,
    lockRoleInvariant: 0,
  };
  /** Every `replaceRoles`, so `granted_by` can be asserted (ADR-0017). */
  const grants: { staffId: string; grantedBy: string | null }[] = [];
  let sequence = 0;

  const repository: StaffRepository = {
    findByEmail: (email) =>
      Promise.resolve(
        [...rows.values()]
          .filter((row) => row.email === email)
          .map(toRecord)[0],
      ),

    /** `active` only, as the real query is (ADR-0071 §4). */
    findActiveByEmail: (email) =>
      Promise.resolve(
        [...rows.values()]
          .filter((row) => row.email === email && row.status === "active")
          .map((row) => ({ id: row.id, email: row.email }))[0],
      ),

    findById: (id) => {
      const row = rows.get(id);

      return Promise.resolve(row === undefined ? undefined : toRecord(row));
    },

    list: (query: ListStaffQuery) => {
      const all = [...rows.values()].map(toRecord);

      return Promise.resolve({
        rows: all.slice(query.offset, query.offset + query.limit),
        total: all.length,
      });
    },

    create: (input: NewStaffInput) => {
      if ([...rows.values()].some((row) => row.email === input.email)) {
        return Promise.resolve(undefined);
      }

      sequence += 1;
      const row: FakeStaffRow = {
        id: `created-${String(sequence)}`,
        email: input.email,
        passwordHash: input.passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        // The caller's, since ADR-0071 §8: an invitation writes `invited` and
        // a password writes `active`, and a fake that hard-coded one of them
        // would pass whichever the service sent.
        status: input.status,
        roles: [],
      };

      rows.set(row.id, row);

      return Promise.resolve(toRecord(row));
    },

    /** The onboarding link's write (ADR-0071 §8), `invited` rows only. */
    activateOnboarded: (id: string, passwordHash: string) => {
      const row = rows.get(id);

      if (row === undefined || row.status !== "invited")
        return Promise.resolve(undefined);

      row.passwordHash = passwordHash;
      row.status = "active";

      return Promise.resolve(toRecord(row));
    },

    updateColumns: (id: string, patch: StaffColumnPatch) => {
      calls.updateColumns += 1;
      const row = rows.get(id);

      if (row === undefined) return Promise.resolve(false);

      if (patch.firstName !== undefined) row.firstName = patch.firstName;
      if (patch.lastName !== undefined) row.lastName = patch.lastName;
      if (patch.status !== undefined) row.status = patch.status;

      return Promise.resolve(true);
    },

    replaceRoles: (
      staffId: string,
      roles: readonly StaffRole[],
      grantedBy: string | null,
    ) => {
      calls.replaceRoles += 1;
      grants.push({ staffId, grantedBy });
      const row = rows.get(staffId);

      if (row !== undefined) row.roles = [...roles];

      return Promise.resolve();
    },

    countOtherActiveSuperAdmins: (id: string) =>
      Promise.resolve(
        [...rows.values()].filter(
          (row) =>
            row.id !== id &&
            row.status === "active" &&
            row.roles.includes("super_admin"),
        ).length,
      ),

    // A no-op: the fakes are single-threaded, so there is nothing to
    // serialise. That the *real* service takes the lock before it reads is a
    // property only the database can demonstrate, and the integration suite
    // is where it is exercised.
    lockRoleInvariant: () => {
      calls.lockRoleInvariant += 1;

      return Promise.resolve();
    },

    remove: (id: string) => Promise.resolve(rows.delete(id)),

    /** The unique index on `email`, which is total on this table (ADR-0028). */
    emailTaken: (email: string) =>
      Promise.resolve([...rows.values()].some((row) => row.email === email)),

    /**
     * The administrative set (ADR-0071 §7), refused when any row already holds
     * the address — the fake's version of the statement's own `NOT EXISTS`.
     */
    updateEmail: (id: string, email: string) => {
      const row = rows.get(id);

      if (row === undefined) return Promise.resolve(false);
      if ([...rows.values()].some((other) => other.email === email)) {
        return Promise.resolve(false);
      }

      row.email = email;

      return Promise.resolve(true);
    },

    updateLastLoginAt: () => Promise.resolve(),
    // A no-op until D2.3, when the staff module gained endpoints that write a
    // password rather than only the login-time argon2 upgrade.
    updatePasswordHash: (id: string, passwordHash: string) => {
      calls.updatePasswordHash += 1;
      const row = rows.get(id);

      if (row !== undefined) row.passwordHash = passwordHash;

      return Promise.resolve();
    },
  };

  return { repository, rows, calls, grants } as const;
};

/** Cheap by design: argon2's correctness belongs to `@repo/crypto`. */
export const createFakeHasher = () => {
  const calls = { hash: 0, verify: 0 };

  const hasher: LimitedHasher = {
    hash: (password) => {
      calls.hash += 1;

      return Promise.resolve(`hashed:${password}`);
    },
    verify: (digest, password) =>
      Promise.resolve(digest === `hashed:${password}`),
  };

  return { hasher, calls } as const;
};

export const createFakeSessions = () => {
  const revocations: {
    principalId: string;
    reason: string;
    exceptSessionId?: string | undefined;
  }[] = [];

  return {
    revocations,
    sessions: {
      revokeSessionsFor: (
        _ctx: RequestContext,
        input: {
          principalId: string;
          reason: string;
          exceptSessionId?: string | undefined;
        },
      ) => {
        // `exceptSessionId` is recorded because it is the whole difference
        // between a self-service change and an administrative reset (ADR-0027).
        revocations.push({
          principalId: input.principalId,
          reason: input.reason,
          exceptSessionId: input.exceptSessionId,
        });

        return Promise.resolve(1);
      },
    },
  } as const;
};

/* ── harness ──────────────────────────────────────────────────────────────── */

export const staffPrincipal = (
  id: string,
  roles: readonly StaffRole[],
): Principal => ({
  kind: "staff",
  id,
  roles,
  sessionId: "session-1",
});

export const contextFor = (principal: Principal | null): RequestContext => {
  const ctx = createRequestContext({
    requestId: "req-1",
    logger: createLogger({ level: "silent", name: "test" }),
  });

  ctx.principal = principal;

  return ctx;
};

export const superAdminRow = (): FakeStaffRow => ({
  id: SUPER_ADMIN_ID,
  email: "root@machxi.local",
  passwordHash: "hashed:secret",
  firstName: "Root",
  lastName: "Admin",
  status: "active",
  roles: ["super_admin"],
});

export const adminRow = (): FakeStaffRow => ({
  id: ADMIN_ID,
  email: "admin@machxi.local",
  passwordHash: "hashed:secret",
  firstName: "Ada",
  lastName: "Admin",
  status: "active",
  roles: ["admin"],
});

/**
 * The acting `admin`'s own row.
 *
 * Needed since D2.3 because the credential endpoints read the actor back and
 * verify the password they present, so a context alone no longer describes a
 * caller — `ACTOR_ID` has to exist in the table too.
 */
export const actorRow = (): FakeStaffRow => ({
  id: ACTOR_ID,
  email: "actor@machxi.local",
  passwordHash: "hashed:actor-secret",
  firstName: "Alex",
  lastName: "Actor",
  status: "active",
  roles: ["admin"],
});

/** What {@link actorRow} presents on a credential endpoint. */
export const ACTOR_PASSWORD = "actor-secret";

/**
 * ADR-0058's writer, recording what was appended (`D18.10`).
 *
 * What a fake proves here is the entry — the event name, and that both
 * addresses and the subject are on the row ADR-0071 §7 asks for. Whether it
 * survives a rollback is a property of the real transaction and is proved
 * against Postgres.
 */
export const createFakeAudit = () => {
  const entries: AuditEntry[] = [];

  const audit: Audit = {
    record: (_ctx, entry) => {
      entries.push(entry);

      return Promise.resolve();
    },
    trail: (_ctx, entry) => {
      entries.push(entry);
    },
  };

  return { audit, entries } as const;
};

/** ADR-0071 §1's service, narrowed to the one call this module makes of it. */
export const createFakeAccountTokens = () => {
  const superseded: { purpose: string; principalId: string }[] = [];
  /** Every `staff_onboarding` mint, so the link's principal can be asserted. */
  const minted: { purpose: string; principalId: string }[] = [];

  return {
    superseded,
    minted,
    accountTokens: {
      mint: (
        _ctx: RequestContext,
        input: { purpose: string; principal: { id: string } },
      ) => {
        minted.push({
          purpose: input.purpose,
          principalId: input.principal.id,
        });

        return Promise.resolve({
          token: `token-${String(minted.length)}`,
          expiresAt: NOW,
        });
      },
      consume: () => Promise.resolve(undefined),
      supersede: (
        _ctx: RequestContext,
        input: { purpose: string; principal: { id: string } },
      ) => {
        superseded.push({
          purpose: input.purpose,
          principalId: input.principal.id,
        });

        return Promise.resolve(0);
      },
    } as unknown as AccountTokens,
  } as const;
};

/**
 * ADR-0066 §1's port, recording what went out (`D18.11`).
 *
 * The `to` and the subject are what the onboarding cases assert — that an
 * invitation mails the address the row holds, and that a create with a
 * password mails nothing at all. The link itself is the templates' business
 * and is proved against them in `core/mail/__tests__/templates.test.ts`.
 */
export const createFakeMail = () => {
  const sent: { to: string; subject: string }[] = [];

  const mail: MailSender = {
    send: (_ctx, message) => {
      sent.push({ to: message.to, subject: message.subject });

      return Promise.resolve();
    },
  };

  return { mail, sent } as const;
};

export const build = (seed: FakeStaffRow[]) => {
  const repo = createFakeRepository(seed);
  const hasher = createFakeHasher();
  const sessions = createFakeSessions();
  const audit = createFakeAudit();
  const tokens = createFakeAccountTokens();
  const mail = createFakeMail();

  const service = createStaffService({
    repository: repo.repository,
    hasher: hasher.hasher,
    sessions: sessions.sessions,
    audit: audit.audit,
    accountTokens: tokens.accountTokens,
    mail: mail.mail,
    // The real templates, built on two throwaway origins: what these cases
    // assert about a message is its recipient, and a fake template would only
    // be able to prove that a fake was called.
    mailTemplates: createMailTemplates({
      customerUrl: "http://customer.test",
      adminUrl: "http://admin.test",
    }),
    // The service composes repositories, and the fakes share no state that a
    // rollback would have to undo, so "one transaction" is just "run it".
    transaction: (fn) => fn(undefined as never),
    now: () => NOW,
  });

  return { service, repo, hasher, sessions, audit, tokens, mail } as const;
};

/** An `admin` caller — enough for every endpoint, per `authorize("admin")`. */
export const ctx = () => contextFor(staffPrincipal(ACTOR_ID, ["admin"]));
/** A `super_admin` caller, needed for any change to `super_admin` membership. */
export const superCtx = () =>
  contextFor(staffPrincipal(ACTOR_ID, ["admin", "super_admin"]));

export const expectAppError = async (
  run: () => Promise<unknown>,
  code: string,
  status: number,
): Promise<void> => {
  await expect(run()).rejects.toSatisfy(
    (error: unknown) =>
      isAppError(error) && error.code === code && error.status === status,
  );
};
