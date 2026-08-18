import type { ListUsersQuery, UserRole, UserStatus } from "@repo/contracts";
import { createLogger } from "@repo/logger";
import { describe, expect, it } from "vitest";

import type { LimitedHasher } from "../../../core/auth/index.js";
import {
  createRequestContext,
  type Principal,
  type RequestContext,
} from "../../../core/context/index.js";
import { isAppError } from "../../../core/errors/index.js";
import { REVOKE_REASONS } from "../../auth/index.js";
import type {
  NewUserInput,
  UserColumnPatch,
  UserRecord,
  UsersRepository,
} from "../users.repository.js";
import { createUsersService } from "../users.service.js";

/**
 * The users module against fake repositories (ADR-0021 §Unit).
 *
 * One service serves two segments, and the rules worth isolating here are the
 * ones that keep them apart: the admin functions take an id, the profile
 * functions read `ctx.principal` and can therefore never act on somebody else
 * (ADR-0019 §3). The change-password sequence gets the most attention — it is
 * the only place in the step that verifies a credential.
 */

const USER_ID = "44444444-4444-7444-8444-444444444444";
const OTHER_ID = "55555555-5555-7555-8555-555555555555";
const SESSION_ID = "session-1";
const NOW = new Date("2026-08-18T12:00:00.000Z");

/* ── fakes ────────────────────────────────────────────────────────────────── */

interface FakeUserRow {
  readonly id: string;
  email: string;
  passwordHash: string | null;
  firstName: string | null;
  lastName: string | null;
  status: UserStatus;
  roles: readonly UserRole[];
  deleted: boolean;
}

const toRecord = (row: FakeUserRow): UserRecord => ({
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
const createFakeRepository = (seed: FakeUserRow[]) => {
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
      };

      rows.set(row.id, row);

      return Promise.resolve(toRecord(row));
    },

    updateColumns: (id: string, patch: UserColumnPatch) => {
      const row = rows.get(id);

      if (row === undefined) return Promise.resolve(false);

      // `!== undefined`, not `??`: `null` is a value that clears the column.
      if (patch.firstName !== undefined) row.firstName = patch.firstName;
      if (patch.lastName !== undefined) row.lastName = patch.lastName;
      if (patch.status !== undefined) row.status = patch.status;

      return Promise.resolve(true);
    },

    grantRole: () => Promise.resolve(),

    replaceRoles: (userId: string, roles: readonly UserRole[]) => {
      calls.replaceRoles += 1;
      const row = rows.get(userId);

      if (row !== undefined) row.roles = [...roles];

      return Promise.resolve();
    },

    updateLastLoginAt: () => Promise.resolve(),

    updatePasswordHash: (id: string, passwordHash: string) => {
      calls.updatePasswordHash += 1;
      const row = rows.get(id);

      if (row !== undefined) row.passwordHash = passwordHash;

      return Promise.resolve();
    },
  };

  return { repository, rows, calls } as const;
};

const createFakeHasher = () => {
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

interface Revocation {
  principalId: string;
  reason: string;
  exceptSessionId: string | undefined;
}

const createFakeSessions = () => {
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

/* ── harness ──────────────────────────────────────────────────────────────── */

const userPrincipal = (id: string): Principal => ({
  kind: "user",
  id,
  roles: ["customer"],
  sessionId: SESSION_ID,
});

const staffPrincipal = (): Principal => ({
  kind: "staff",
  id: "99999999-9999-7999-8999-999999999999",
  roles: ["admin"],
  sessionId: "staff-session",
});

const contextFor = (principal: Principal | null): RequestContext => {
  const ctx = createRequestContext({
    requestId: "req-1",
    logger: createLogger({ level: "silent", name: "test" }),
  });

  ctx.principal = principal;

  return ctx;
};

const userRow = (overrides: Partial<FakeUserRow> = {}): FakeUserRow => ({
  id: USER_ID,
  email: "customer@machxi.local",
  passwordHash: "hashed:CurrentPassword!1",
  firstName: "Cleo",
  lastName: "Customer",
  status: "active",
  roles: ["customer"],
  deleted: false,
  ...overrides,
});

const build = (seed: FakeUserRow[]) => {
  const repo = createFakeRepository(seed);
  const hasher = createFakeHasher();
  const sessions = createFakeSessions();

  const service = createUsersService({
    repository: repo.repository,
    hasher: hasher.hasher,
    sessions: sessions.sessions,
    transaction: (fn) => fn(undefined as never),
    now: () => NOW,
  });

  return { service, repo, hasher, sessions } as const;
};

/** The admin segment: a staff principal acting on somebody else's account. */
const adminCtx = () => contextFor(staffPrincipal());
/** The user segment: the account acting on itself. */
const selfCtx = (id = USER_ID) => contextFor(userPrincipal(id));

const expectAppError = async (
  run: () => Promise<unknown>,
  code: string,
  status: number,
): Promise<void> => {
  await expect(run()).rejects.toSatisfy(
    (error: unknown) =>
      isAppError(error) && error.code === code && error.status === status,
  );
};

const emptyQuery = (): ListUsersQuery => ({
  offset: 0,
  limit: 20,
  sort: [{ field: "createdAt", direction: "desc" }],
  filters: [],
});

/* ── tests ────────────────────────────────────────────────────────────────── */

describe("createUsersService — the admin segment", () => {
  describe("list", () => {
    it("returns a page that echoes the resolved query for `meta`", async () => {
      const { service } = build([userRow(), userRow({ id: OTHER_ID })]);

      const page = await service.list(adminCtx(), emptyQuery());

      expect(page.items).toHaveLength(2);
      expect(page).toMatchObject({ total: 2, offset: 0, limit: 20 });
    });

    it("keeps the password hash out of the page", async () => {
      const { service } = build([userRow()]);

      const page = await service.list(adminCtx(), emptyQuery());

      expect(page.items[0]).not.toHaveProperty("passwordHash");
      expect(JSON.stringify(page)).not.toContain("hashed:");
    });
  });

  describe("getById", () => {
    it("returns the resource", async () => {
      const { service } = build([userRow()]);

      await expect(service.getById(adminCtx(), USER_ID)).resolves.toMatchObject(
        { id: USER_ID, email: "customer@machxi.local", roles: ["customer"] },
      );
    });

    it("still returns a soft-deleted account", async () => {
      // An admin who can list deleted accounts must be able to open one;
      // answering 404 for a row they were just shown is the worse lie.
      const { service } = build([userRow({ deleted: true })]);

      await expect(service.getById(adminCtx(), USER_ID)).resolves.toMatchObject(
        { id: USER_ID },
      );
    });

    it("answers NOT_FOUND for an unknown id", async () => {
      const { service } = build([]);

      await expectAppError(
        () => service.getById(adminCtx(), USER_ID),
        "NOT_FOUND",
        404,
      );
    });
  });

  describe("create", () => {
    it("defaults the roles to `customer` when the body omits them", async () => {
      // v1 has exactly one user role, and an account with none can do nothing
      // (ADR-0017).
      const { service } = build([]);

      const created = await service.create(adminCtx(), {
        email: "new@machxi.local",
        password: "InitialPassword!1",
      });

      expect(created.roles).toEqual(["customer"]);
    });

    it("honours an explicit status", async () => {
      const { service } = build([]);

      await expect(
        service.create(adminCtx(), {
          email: "new@machxi.local",
          password: "InitialPassword!1",
          status: "pending_verification",
        }),
      ).resolves.toMatchObject({ status: "pending_verification" });
    });

    it("hashes the password", async () => {
      const { service, hasher, repo } = build([]);

      const created = await service.create(adminCtx(), {
        email: "new@machxi.local",
        password: "InitialPassword!1",
      });

      expect(hasher.calls.hash).toBe(1);
      expect(repo.rows.get(created.id)?.passwordHash).toBe(
        "hashed:InitialPassword!1",
      );
    });

    it("answers USER_EMAIL_TAKEN for a duplicate address", async () => {
      // Named, unlike anonymous registration, because the caller is staff who
      // can already list every address (ADR-0020 §Enumeration).
      const { service } = build([userRow()]);

      await expectAppError(
        () =>
          service.create(adminCtx(), {
            email: "customer@machxi.local",
            password: "InitialPassword!1",
          }),
        "USER_EMAIL_TAKEN",
        409,
      );
    });
  });

  describe("update", () => {
    it("clears a name when the patch sends null", async () => {
      // The column is nullable, so "unset it" is a legal request that must be
      // distinguishable from "leave it".
      const { service } = build([userRow()]);

      await expect(
        service.update(adminCtx(), USER_ID, { firstName: null }),
      ).resolves.toMatchObject({ firstName: null, lastName: "Customer" });
    });

    it("leaves a name alone when the patch omits it", async () => {
      const { service } = build([userRow()]);

      await expect(
        service.update(adminCtx(), USER_ID, { lastName: "Renamed" }),
      ).resolves.toMatchObject({ firstName: "Cleo", lastName: "Renamed" });
    });

    it("replaces the role set", async () => {
      const { service, repo } = build([userRow({ roles: [] })]);

      await service.update(adminCtx(), USER_ID, { roles: ["customer"] });

      expect(repo.rows.get(USER_ID)?.roles).toEqual(["customer"]);
    });

    it("leaves the roles alone when the patch does not mention them", async () => {
      const { service, repo } = build([userRow()]);

      await service.update(adminCtx(), USER_ID, { firstName: "Cleopatra" });

      expect(repo.calls.replaceRoles).toBe(0);
    });

    it("revokes every session when an active account is disabled", async () => {
      const { service, sessions } = build([userRow()]);

      await service.update(adminCtx(), USER_ID, { status: "disabled" });

      expect(sessions.revocations).toEqual([
        {
          principalId: USER_ID,
          reason: REVOKE_REASONS.accountDisabled,
          exceptSessionId: undefined,
        },
      ]);
    });

    it("revokes when the role set changes", async () => {
      // Roles ride in the token's claims, so revoking is what makes the change
      // take effect rather than waiting out `JWT_ACCESS_TTL` (ADR-0018).
      const { service, sessions } = build([userRow()]);

      await service.update(adminCtx(), USER_ID, { roles: ["customer"] });

      expect(sessions.revocations).toEqual([]);

      const cleared = build([userRow({ roles: [] })]);

      await cleared.service.update(adminCtx(), USER_ID, {
        roles: ["customer"],
      });

      expect(cleared.sessions.revocations).toEqual([
        {
          principalId: USER_ID,
          reason: REVOKE_REASONS.rolesChanged,
          exceptSessionId: undefined,
        },
      ]);
    });

    it("does not revoke when the account was already inactive", async () => {
      const { service, sessions } = build([userRow({ status: "disabled" })]);

      await service.update(adminCtx(), USER_ID, { status: "disabled" });

      expect(sessions.revocations).toEqual([]);
    });

    it("answers NOT_FOUND for an unknown id", async () => {
      const { service } = build([]);

      await expectAppError(
        () => service.update(adminCtx(), USER_ID, { firstName: "Ghost" }),
        "NOT_FOUND",
        404,
      );
    });
  });

  describe("revokeSessions", () => {
    it("revokes with the admin reason", async () => {
      const { service, sessions } = build([userRow()]);

      await service.revokeSessions(adminCtx(), USER_ID);

      expect(sessions.revocations).toEqual([
        {
          principalId: USER_ID,
          reason: REVOKE_REASONS.adminRevoke,
          exceptSessionId: undefined,
        },
      ]);
    });

    it("answers NOT_FOUND for an unknown id rather than a silent success", async () => {
      const { service, sessions } = build([]);

      await expectAppError(
        () => service.revokeSessions(adminCtx(), USER_ID),
        "NOT_FOUND",
        404,
      );
      expect(sessions.revocations).toEqual([]);
    });
  });
});

describe("createUsersService — the user segment", () => {
  describe("getProfile", () => {
    it("reads the account from `ctx.principal`, not from an argument", async () => {
      const { service } = build([
        userRow(),
        userRow({ id: OTHER_ID, email: "other@machxi.local" }),
      ]);

      await expect(service.getProfile(selfCtx())).resolves.toMatchObject({
        id: USER_ID,
        email: "customer@machxi.local",
      });
    });

    it("refuses a staff principal", async () => {
      // A staff principal here can only come from a router mounted with the
      // wrong guard, and it answers 401 — never 403, which would confirm the
      // route exists to the wrong population (ADR-0019 §1).
      const { service } = build([userRow()]);

      await expectAppError(
        () => service.getProfile(adminCtx()),
        "UNAUTHENTICATED",
        401,
      );
    });

    it("answers NOT_FOUND once the account is soft-deleted", async () => {
      // `authenticate` verifies the session, not the account, so a deletion
      // inside the token's lifetime is only caught here.
      const { service } = build([userRow({ deleted: true })]);

      await expectAppError(
        () => service.getProfile(selfCtx()),
        "NOT_FOUND",
        404,
      );
    });
  });

  describe("updateProfile", () => {
    it("updates only the caller's own row", async () => {
      const { service, repo } = build([
        userRow(),
        userRow({ id: OTHER_ID, firstName: "Other" }),
      ]);

      await service.updateProfile(selfCtx(), { firstName: "Cleopatra" });

      expect(repo.rows.get(USER_ID)?.firstName).toBe("Cleopatra");
      expect(repo.rows.get(OTHER_ID)?.firstName).toBe("Other");
    });

    it("clears a name when the body sends null", async () => {
      const { service } = build([userRow()]);

      await expect(
        service.updateProfile(selfCtx(), { lastName: null }),
      ).resolves.toMatchObject({ lastName: null });
    });

    it("refuses a soft-deleted account before writing anything", async () => {
      const { service, repo } = build([userRow({ deleted: true })]);

      await expectAppError(
        () => service.updateProfile(selfCtx(), { firstName: "Ghost" }),
        "NOT_FOUND",
        404,
      );
      expect(repo.rows.get(USER_ID)?.firstName).toBe("Cleo");
    });
  });

  describe("changePassword", () => {
    const body = {
      currentPassword: "CurrentPassword!1",
      newPassword: "BrandNewPassword!2",
    } as const;

    it("stores the new hash", async () => {
      const { service, repo } = build([userRow()]);

      await service.changePassword(selfCtx(), body);

      expect(repo.rows.get(USER_ID)?.passwordHash).toBe(
        "hashed:BrandNewPassword!2",
      );
    });

    it("revokes every other session and spares the caller's own", async () => {
      // A password change is how somebody ends a session they no longer
      // control, so leaving the others alive would defeat the point — and
      // logging out the device in hand is a worse experience for no gain,
      // since that session is the one they just proved they own.
      const { service, sessions } = build([userRow()]);

      await service.changePassword(selfCtx(), body);

      expect(sessions.revocations).toEqual([
        {
          principalId: USER_ID,
          reason: REVOKE_REASONS.passwordChanged,
          exceptSessionId: SESSION_ID,
        },
      ]);
    });

    it("answers USER_CURRENT_PASSWORD_INVALID when the current password is wrong", async () => {
      const { service } = build([userRow()]);

      await expectAppError(
        () =>
          service.changePassword(selfCtx(), {
            currentPassword: "NotThePassword!9",
            newPassword: body.newPassword,
          }),
        "USER_CURRENT_PASSWORD_INVALID",
        403,
      );
    });

    it("writes nothing and revokes nothing when verification fails", async () => {
      const { service, repo, sessions } = build([userRow()]);

      await expect(
        service.changePassword(selfCtx(), {
          currentPassword: "NotThePassword!9",
          newPassword: body.newPassword,
        }),
      ).rejects.toThrow();

      expect(repo.calls.updatePasswordHash).toBe(0);
      expect(sessions.revocations).toEqual([]);
    });

    it("refuses an account that has no password at all", async () => {
      // `null` means "no password login" (ADR-0017), never "any password
      // matches" — and it fails through the same answer a wrong password gets.
      const { service, hasher } = build([userRow({ passwordHash: null })]);

      await expectAppError(
        () => service.changePassword(selfCtx(), body),
        "USER_CURRENT_PASSWORD_INVALID",
        403,
      );
      expect(hasher.calls.verify).toBe(0);
    });

    it("refuses a staff principal", async () => {
      const { service } = build([userRow()]);

      await expectAppError(
        () => service.changePassword(adminCtx(), body),
        "UNAUTHENTICATED",
        401,
      );
    });
  });
});
