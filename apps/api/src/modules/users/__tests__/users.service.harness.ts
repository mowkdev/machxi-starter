import {
  TOKEN_PURPOSES,
  type ListUsersQuery,
  type Locale,
  type UserRole,
  type UserStatus,
} from "@repo/contracts";
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
import { createMailTemplates } from "../../../core/mail/index.js";
import type { MailMessage, MailSender } from "../../../core/mail/index.js";
import type { AccountTokens } from "../../../core/tokens/index.js";
import type { SettingsService } from "../../settings/index.js";
import { currentPasswordInvalid } from "../../auth/index.js";
import type {
  NewUserInput,
  UserColumnPatch,
  UserRecord,
  UsersRepository,
} from "../users.repository.js";
import { createUsersService } from "../users.service.js";

/**
 * The fakes and the harness the users module's unit suites are built on
 * (ADR-0021 §Unit).
 *
 * Extracted at `D20.7`, when `users.lifecycle.service.test.ts` took the cases
 * for the three writes that carry the personal-organization glue: both suites
 * drive the module through `createUsersService`, so they have to drive it
 * through the same fakes or "the same service" stops being what is under test.
 * Not a `*.test.ts` file, so Vitest does not collect it.
 *
 * One service serves two segments, and the rules worth isolating here are the
 * ones that keep them apart: the admin functions take an id, the profile
 * functions read `ctx.principal` and can therefore never act on somebody else
 * (ADR-0019 §3). The change-password sequence gets the most attention — it is
 * the only place in the step that verifies a credential.
 */

export const USER_ID = "44444444-4444-7444-8444-444444444444";
export const OTHER_ID = "55555555-5555-7555-8555-555555555555";
export const SESSION_ID = "session-1";
/** What the acting staff member presents on `POST /:id/password` (D2.3). */
export const ACTOR_PASSWORD = "actor-secret";
export const NOW = new Date("2026-08-18T12:00:00.000Z");
/** What the fake mint hands back, so a test can find it in a rendered link. */
export const MINTED_TOKEN = "minted-token-value";
/** `CUSTOMER_APP_URL` as the templates are built with here (ADR-0071 §1). */
export const CUSTOMER_URL = "https://app.machxi.test";

/* ── fakes ────────────────────────────────────────────────────────────────── */

export interface FakeUserRow {
  readonly id: string;
  email: string;
  passwordHash: string | null;
  firstName: string | null;
  lastName: string | null;
  status: UserStatus;
  roles: readonly UserRole[];
  deleted: boolean;
  /** When the address was proven, or asserted by staff (ADR-0071 §3). */
  emailVerifiedAt: Date | null;
}

export const toRecord = (row: FakeUserRow): UserRecord => ({
  id: row.id,
  email: row.email,
  passwordHash: row.passwordHash,
  firstName: row.firstName,
  lastName: row.lastName,
  status: row.status,
  roles: row.roles,
  lastLoginAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: row.deleted ? NOW : null,
});

/**
 * An in-memory `users` + `user_roles` pair.
 *
 * The behaviour it must reproduce faithfully is soft deletion: `findById`
 * hides a deleted row and `findAnyById` does not, because the whole
 * admin-versus-self distinction below rests on which one a function calls.
 */
export const createFakeRepository = (seed: FakeUserRow[]) => {
  const rows = new Map(seed.map((row) => [row.id, { ...row }]));
  const calls = { replaceRoles: 0, updatePasswordHash: 0 };
  let sequence = 0;

  const repository: UsersRepository = {
    findByEmail: (email) =>
      Promise.resolve(
        [...rows.values()]
          .filter((row) => row.email === email && !row.deleted)
          .map(toRecord)[0],
      ),

    /** `active` and undeleted only, as the real query is (ADR-0071 §4). */
    findActiveByEmail: (email) =>
      Promise.resolve(
        [...rows.values()]
          .filter(
            (row) =>
              row.email === email && !row.deleted && row.status === "active",
          )
          .map((row) => ({ id: row.id, email: row.email }))[0],
      ),

    findById: (id) => {
      const row = rows.get(id);

      return Promise.resolve(
        row === undefined || row.deleted ? undefined : toRecord(row),
      );
    },

    findAnyById: (id) => {
      const row = rows.get(id);

      return Promise.resolve(row === undefined ? undefined : toRecord(row));
    },

    list: (query: ListUsersQuery) => {
      const asksAboutDeletion = query.filters.some(
        (filter) => filter.field === "deletedAt",
      );
      const all = [...rows.values()]
        .filter((row) => asksAboutDeletion || !row.deleted)
        .map(toRecord);

      return Promise.resolve({
        rows: all.slice(query.offset, query.offset + query.limit),
        total: all.length,
      });
    },

    create: (input: NewUserInput) => {
      if ([...rows.values()].some((row) => row.email === input.email)) {
        return Promise.resolve(undefined);
      }

      sequence += 1;
      const row: FakeUserRow = {
        id: `created-${String(sequence)}`,
        email: input.email,
        passwordHash: input.passwordHash,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        status: input.status ?? "active",
        roles: [],
        deleted: false,
        emailVerifiedAt: input.emailVerifiedAt ?? null,
      };

      rows.set(row.id, row);

      return Promise.resolve(toRecord(row));
    },

    markEmailVerified: (id: string, at: Date) => {
      const row = rows.get(id);

      // The real statement matches `status = 'pending_verification'` inside
      // the update, so nothing else moves (ADR-0071 §3).
      if (
        row === undefined ||
        row.deleted ||
        row.status !== "pending_verification"
      ) {
        return Promise.resolve(undefined);
      }

      const verified: FakeUserRow = {
        ...row,
        status: "active",
        emailVerifiedAt: at,
      };

      rows.set(id, verified);

      return Promise.resolve(toRecord(verified));
    },

    findPendingVerificationByEmail: (email: string) => {
      const row = [...rows.values()].find(
        (candidate) =>
          candidate.email === email &&
          !candidate.deleted &&
          candidate.status === "pending_verification",
      );

      return Promise.resolve(
        row === undefined ? undefined : { id: row.id, email: row.email },
      );
    },

    updateColumns: (id: string, patch: UserColumnPatch, at: Date) => {
      const row = rows.get(id);

      if (row === undefined) return Promise.resolve(false);

      // `!== undefined`, not `??`: `null` is a value that clears the column.
      if (patch.firstName !== undefined) row.firstName = patch.firstName;
      if (patch.lastName !== undefined) row.lastName = patch.lastName;
      if (patch.status !== undefined) row.status = patch.status;
      // The real statement writes `coalesce(email_verified_at, at)` whenever
      // the status becomes `active` (ADR-0071 §3). Reproduced here so the fake
      // cannot let a unit test believe in a row this repository can no longer
      // produce; that the *database* does it is
      // `users-admin.int.test.ts`'s claim.
      if (patch.status === "active") row.emailVerifiedAt ??= at;

      return Promise.resolve(true);
    },

    grantRole: () => Promise.resolve(),

    replaceRoles: (userId: string, roles: readonly UserRole[]) => {
      calls.replaceRoles += 1;
      const row = rows.get(userId);

      if (row !== undefined) row.roles = [...roles];

      return Promise.resolve();
    },

    softDelete: (id: string) => {
      const row = rows.get(id);

      if (row === undefined || row.deleted) return Promise.resolve(false);

      row.deleted = true;
      // Written alongside the timestamp so `status` stays a truthful column on
      // its own: `filter[status][eq]=active` is an allow-listed filter, and an
      // active-and-deleted account would satisfy it (ADR-0028).
      row.status = "disabled";

      return Promise.resolve(true);
    },

    /** Live rows only, which is the partial unique index's own predicate. */
    emailTaken: (email: string) =>
      Promise.resolve(
        [...rows.values()].some((row) => row.email === email && !row.deleted),
      ),

    /**
     * The address change's write (ADR-0071 §6): the new address and the stamp
     * together, live and `active` rows only, and refused when a live row
     * already holds the address — the fake's version of the statement's own
     * `NOT EXISTS`.
     */
    updateEmailVerified: (id: string, email: string, at: Date) => {
      const row = rows.get(id);

      if (row === undefined || row.deleted || row.status !== "active") {
        return Promise.resolve(undefined);
      }

      if (
        [...rows.values()].some(
          (other) => other.email === email && !other.deleted,
        )
      ) {
        return Promise.resolve(undefined);
      }

      row.email = email;
      row.emailVerifiedAt = at;

      return Promise.resolve(toRecord(row));
    },

    /**
     * The super admin's administrative set (ADR-0071 §7): the address, the
     * stamp written **unconditionally** so it always describes the address now
     * on the row, and refused when a live row already holds the address — the
     * fake's version of the statement's `NOT EXISTS`. Unlike
     * `updateEmailVerified` above, `status` is not in the *predicate* — but
     * since `D20.5` it decides the stamp, which the statement now derives from
     * the row rather than taking from the caller, so the fake reads it off the
     * row for the same reason.
     */
    setEmail: (id: string, email: string, at: Date) => {
      const row = rows.get(id);

      if (row === undefined || row.deleted) return Promise.resolve(undefined);

      if (
        [...rows.values()].some(
          (other) => other.email === email && !other.deleted,
        )
      ) {
        return Promise.resolve(undefined);
      }

      row.email = email;
      row.emailVerifiedAt = row.status === "pending_verification" ? null : at;

      return Promise.resolve(toRecord(row));
    },

    updateLastLoginAt: () => Promise.resolve(),

    updatePasswordHash: (id: string, passwordHash: string) => {
      calls.updatePasswordHash += 1;
      const row = rows.get(id);

      if (row !== undefined) row.passwordHash = passwordHash;

      return Promise.resolve();
    },

    // No account in these cases has linked an identity; the federated half
    // of the aggregate is proved against Postgres (ADR-0072 §3,
    // `federated-identity.int.test.ts`).
    identitiesOf: () => Promise.resolve([]),
    findIdentityBySubject: () => Promise.resolve(undefined),
    linkIdentity: () => Promise.resolve(false),
    touchIdentityLogin: () => Promise.resolve(false),
    unlinkIdentity: () => Promise.resolve(false),
    unlinkIdentities: () => Promise.resolve([]),
    // A lock is an ordering between transactions, which a map in memory has
    // none of; the serialisation it buys is proved against Postgres.
    lockById: () => Promise.resolve(),
  };

  return { repository, rows, calls } as const;
};

export const createFakeHasher = () => {
  const calls = { hash: 0, verify: 0 };

  const hasher: LimitedHasher = {
    hash: (password) => {
      calls.hash += 1;

      return Promise.resolve(`hashed:${password}`);
    },
    verify: (digest, password) => {
      calls.verify += 1;

      return Promise.resolve(digest === `hashed:${password}`);
    },
  };

  return { hasher, calls } as const;
};

export interface Revocation {
  principalId: string;
  reason: string;
  exceptSessionId: string | undefined;
}

export const createFakeSessions = () => {
  const revocations: Revocation[] = [];

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
        revocations.push({
          principalId: input.principalId,
          reason: input.reason,
          exceptSessionId: input.exceptSessionId,
        });

        return Promise.resolve(2);
      },
    },
  } as const;
};

/**
 * The staff service, narrowed to the question this module cannot answer about
 * itself: on `POST /api/v1/admin/users/:id/password` the actor is a staff
 * member re-presenting their own password (ADR-0027 rule 1).
 *
 * A fake rather than the real service, because what is under test here is the
 * *order* the users service calls it in and what it does with a rejection —
 * the check itself is exercised in `staff.service.test.ts` and against a real
 * database in the integration suite.
 */
export const createFakeActors = () => {
  const calls = { verifyActorPassword: 0 };

  return {
    calls,
    actors: {
      verifyActorPassword: (_ctx: RequestContext, currentPassword: string) => {
        calls.verifyActorPassword += 1;

        return currentPassword === ACTOR_PASSWORD
          ? Promise.resolve()
          : Promise.reject(currentPasswordInvalid());
      },
    },
  } as const;
};

/**
 * The organizations service, narrowed to the two functions this module calls
 * (ADR-0067 §2).
 *
 * A plain object recording its calls, because what this suite can assert about
 * the edge is that it is taken — that `create` ensures a personal organization
 * and that both deletion paths delete one, each with the account's own `at`.
 * That the writes actually land *in the same transaction* is not a claim a
 * unit test with a fake `transaction` can make; the integration suites in
 * `apps/api/test` are where that is proved.
 */
export const createFakeOrganizations = () => {
  const calls = {
    ensured: [] as string[],
    deleted: [] as { userId: string; at: Date }[],
  };

  return {
    calls,
    organizations: {
      ensurePersonalOrganizationFor: (
        _ctx: RequestContext,
        owner: { readonly id: string },
      ) => {
        calls.ensured.push(owner.id);

        return Promise.resolve(`org-${owner.id}`);
      },
      deletePersonalOrganizationFor: (
        _ctx: RequestContext,
        userId: string,
        at: Date,
      ) => {
        calls.deleted.push({ userId, at });

        return Promise.resolve();
      },
    },
  } as const;
};

/**
 * The settings service, narrowed to the one question this module cannot answer
 * about itself: which language the acting account reads (ADR-0046, ADR-0071
 * §2).
 *
 * A fake, because what this suite asserts about the edge is that it is taken
 * and that its answer reaches both the template and the token's payload — not
 * how a settings row is stored, which `settings.service.test.ts` owns.
 */
export const createFakeLocales = (locale: Locale = "lv") =>
  ({
    locales: {
      get: () =>
        Promise.resolve({ locale } as unknown as Awaited<
          ReturnType<SettingsService["get"]>
        >),
    },
  }) as const;

/**
 * ADR-0071 §1's mint, recording what each flow asked for.
 *
 * The token it hands back is a fixed string: what a fake can prove here is
 * that the purpose, the principal and the **payload** are right, because the
 * payload is what carries the requested address for the hour before anybody
 * proves it. Single use, supersession and "a rolled-back consume spends
 * nothing" are properties of the real statements and are proved against
 * Postgres (`account-tokens.int.test.ts`, D18.2's amendment).
 */
/**
 * ADR-0058's writer, recording what was appended.
 *
 * `record` is awaited by the service and is inside its transaction, so what a
 * fake can prove here is the entry: the event name, and that both addresses
 * and the subject are on it (ADR-0071 §7). Whether the row survives a rollback
 * is a property of the real transaction and is proved against Postgres.
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

export const createFakeAccountTokens = () => {
  const mints: {
    purpose: string;
    principalId: string;
    payload: Record<string, unknown> | undefined;
  }[] = [];
  /** Links spent without a replacement — `D18.9`'s `security-reviewer`. */
  const superseded: { purpose: string; principalId: string }[] = [];

  return {
    mints,
    superseded,
    accountTokens: {
      mint: (
        _ctx: RequestContext,
        input: {
          purpose: string;
          principal: { id: string };
          payload?: Record<string, unknown> | undefined;
        },
      ) => {
        mints.push({
          purpose: input.purpose,
          principalId: input.principal.id,
          payload: input.payload,
        });

        return Promise.resolve({ token: MINTED_TOKEN, expiresAt: NOW });
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
      /** Recorded per purpose, so a case can ask which links an event spent. */
      supersedeAll: (_ctx: RequestContext, principal: { id: string }) => {
        for (const purpose of TOKEN_PURPOSES) {
          superseded.push({ purpose, principalId: principal.id });
        }

        return Promise.resolve(0);
      },
    } as unknown as AccountTokens,
  } as const;
};

/** ADR-0066 §1's port, capturing rather than sending. */
export const createFakeMail = () => {
  const sent: { to: string; subject: string; text: string }[] = [];

  return {
    sent,
    mail: {
      send: (_ctx: RequestContext, message: MailMessage) => {
        sent.push({
          to: message.to,
          subject: message.subject,
          text: message.text,
        });

        return Promise.resolve();
      },
    } as MailSender,
  } as const;
};

/* ── harness ──────────────────────────────────────────────────────────────── */

export const userPrincipal = (id: string): Principal => ({
  kind: "user",
  id,
  roles: ["customer"],
  sessionId: SESSION_ID,
});

export const staffPrincipal = (): Principal => ({
  kind: "staff",
  id: "99999999-9999-7999-8999-999999999999",
  roles: ["admin"],
  sessionId: "staff-session",
});

export const contextFor = (principal: Principal | null): RequestContext => {
  const ctx = createRequestContext({
    requestId: "req-1",
    logger: createLogger({ level: "silent", name: "test" }),
  });

  ctx.principal = principal;

  return ctx;
};

export const userRow = (overrides: Partial<FakeUserRow> = {}): FakeUserRow => ({
  id: USER_ID,
  email: "customer@machxi.local",
  passwordHash: "hashed:CurrentPassword!1",
  firstName: "Cleo",
  lastName: "Customer",
  status: "active",
  roles: ["customer"],
  deleted: false,
  // An existing account, so its address is proven: the backfill stamped every
  // row that predates ADR-0071 §3 and every path since keeps it true.
  emailVerifiedAt: NOW,
  ...overrides,
});

export const build = (seed: FakeUserRow[]) => {
  const repo = createFakeRepository(seed);
  const hasher = createFakeHasher();
  const sessions = createFakeSessions();
  const actors = createFakeActors();
  const organizations = createFakeOrganizations();
  const locales = createFakeLocales();
  const tokens = createFakeAccountTokens();
  const audit = createFakeAudit();
  const mail = createFakeMail();

  const service = createUsersService({
    repository: repo.repository,
    hasher: hasher.hasher,
    sessions: sessions.sessions,
    actors: actors.actors,
    organizations: organizations.organizations,
    locales: locales.locales,
    accountTokens: tokens.accountTokens,
    audit: audit.audit,
    mail: mail.mail,
    // The **real** templates over two fixed origins, so what the address-change
    // cases assert is the message this repository actually renders — including
    // that the token lands after the `#` (ADR-0071 §1).
    mailTemplates: createMailTemplates({
      customerUrl: CUSTOMER_URL,
      adminUrl: "https://admin.machxi.test",
    }),
    transaction: (fn) => fn(undefined as never),
    now: () => NOW,
  });

  return {
    service,
    repo,
    hasher,
    sessions,
    actors,
    organizations,
    tokens,
    audit,
    mail,
  } as const;
};

/** The admin segment: a staff principal acting on somebody else's account. */
export const adminCtx = () => contextFor(staffPrincipal());
/** The user segment: the account acting on itself. */
export const selfCtx = (id = USER_ID) => contextFor(userPrincipal(id));

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

export const emptyQuery = (): ListUsersQuery => ({
  offset: 0,
  limit: 20,
  sort: [{ field: "createdAt", direction: "desc" }],
  filters: [],
  count: true,
});
