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
import { currentPasswordInvalid, REVOKE_REASONS } from "../../auth/index.js";
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
/** What the acting staff member presents on `POST /:id/password` (D2.3). */
const ACTOR_PASSWORD = "actor-secret";
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
  /** When the address was proven, or asserted by staff (ADR-0071 §3). */
  emailVerifiedAt: Date | null;
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
const createFakeActors = () => {
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
const createFakeOrganizations = () => {
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
  // An existing account, so its address is proven: the backfill stamped every
  // row that predates ADR-0071 §3 and every path since keeps it true.
  emailVerifiedAt: NOW,
  ...overrides,
});

const build = (seed: FakeUserRow[]) => {
  const repo = createFakeRepository(seed);
  const hasher = createFakeHasher();
  const sessions = createFakeSessions();
  const actors = createFakeActors();
  const organizations = createFakeOrganizations();

  const service = createUsersService({
    repository: repo.repository,
    hasher: hasher.hasher,
    sessions: sessions.sessions,
    actors: actors.actors,
    organizations: organizations.organizations,
    transaction: (fn) => fn(undefined as never),
    now: () => NOW,
  });

  return { service, repo, hasher, sessions, actors, organizations } as const;
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
  count: true,
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

    it("stamps the address as proven, because staff asserted it", async () => {
      // ADR-0071 §3: the operator who typed the address is the authority a
      // confirmation link would be asking, so no link is sent and the account
      // is `active` with a proven address in one statement. That is what keeps
      // "every `active` user has a proven address" true of this path too.
      const { service, repo } = build([]);

      const created = await service.create(adminCtx(), {
        email: "new@machxi.local",
        password: "InitialPassword!1",
      });

      expect(repo.rows.get(created.id)?.emailVerifiedAt).not.toBeNull();
    });

    it("leaves the stamp null when the admin asks for `pending_verification`", async () => {
      // An admin deliberately creating an account that has proven nothing —
      // the row the `--dev` fixtures carry and the backfill migration skipped.
      // Stamping it would make the column disagree with the status on the one
      // status the verification flow exists to move.
      const { service, repo } = build([]);

      const created = await service.create(adminCtx(), {
        email: "new@machxi.local",
        password: "InitialPassword!1",
        status: "pending_verification",
      });

      expect(repo.rows.get(created.id)?.emailVerifiedAt).toBeNull();
    });

    it("ensures the account's personal organization (ADR-0067 §2)", async () => {
      const { service, organizations } = build([]);

      const created = await service.create(adminCtx(), {
        email: "new@machxi.local",
        password: "InitialPassword!1",
      });

      // One of the three paths that bring a user into existence, so it must
      // create the organization; that the two writes are one *commit* is the
      // integration suite's claim, not this one's.
      expect(organizations.calls.ensured).toEqual([created.id]);
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

    it("answers AUTH_CURRENT_PASSWORD_INVALID when the current password is wrong", async () => {
      const { service } = build([userRow()]);

      await expectAppError(
        () =>
          service.changePassword(selfCtx(), {
            currentPassword: "NotThePassword!9",
            newPassword: body.newPassword,
          }),
        "AUTH_CURRENT_PASSWORD_INVALID",
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
        "AUTH_CURRENT_PASSWORD_INVALID",
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

  /* -- D12.4: self-service deletion (ADR-0055 §4) -------------------------- */

  describe("deleteProfile", () => {
    const body = { currentPassword: "CurrentPassword!1" } as const;

    it("soft-deletes the caller's own row and disables it", async () => {
      // ADR-0028's user semantics, unchanged by the actor: the row survives
      // because future order history references it, and `status` is written
      // beside the timestamp so it stays truthful on its own.
      const { service, repo, organizations } = build([userRow()]);

      await service.deleteProfile(selfCtx(), body);

      expect(repo.rows.get(USER_ID)?.deleted).toBe(true);
      expect(repo.rows.get(USER_ID)?.status).toBe("disabled");
      // The admin path's twin: which actor closed the account does not change
      // what happens to the organization that exists only for it.
      expect(organizations.calls.deleted).toEqual([
        { userId: USER_ID, at: NOW },
      ]);
    });

    it("revokes every session, sparing none — unlike a password change", async () => {
      // The one behavioural difference between this and `changePassword`:
      // there the caller keeps the session they just proved they own, because
      // the point is to end the ones they do not control. Here there is no
      // account left to be signed in to, so `exceptSessionId` is absent from
      // both sweeps.
      const { service, sessions } = build([userRow()]);

      await service.deleteProfile(selfCtx(), body);

      expect(sessions.revocations).toEqual([
        {
          principalId: USER_ID,
          reason: REVOKE_REASONS.accountDeleted,
          exceptSessionId: undefined,
        },
        {
          principalId: USER_ID,
          reason: REVOKE_REASONS.accountDeleted,
          exceptSessionId: undefined,
        },
      ]);
    });

    it("answers AUTH_CURRENT_PASSWORD_INVALID when the password is wrong", async () => {
      const { service } = build([userRow()]);

      await expectAppError(
        () =>
          service.deleteProfile(selfCtx(), {
            currentPassword: "NotThePassword!9",
          }),
        "AUTH_CURRENT_PASSWORD_INVALID",
        403,
      );
    });

    it("deletes nothing and revokes nothing when verification fails", async () => {
      // The rule this covers is that re-authentication runs *before* the
      // write, not beside it: a hijacked tab must not be able to destroy the
      // account, and half a deletion is worse than none.
      const { service, repo, sessions } = build([userRow()]);

      await expect(
        service.deleteProfile(selfCtx(), {
          currentPassword: "NotThePassword!9",
        }),
      ).rejects.toThrow();

      expect(repo.rows.get(USER_ID)?.deleted).toBe(false);
      expect(sessions.revocations).toEqual([]);
    });

    it("refuses an account that has no password at all", async () => {
      // `null` means "no password login" (ADR-0017), never "any password
      // matches" — the same rule `changePassword` follows, and it matters more
      // here because the operation is irreversible.
      const { service, hasher, repo } = build([
        userRow({ passwordHash: null }),
      ]);

      await expectAppError(
        () => service.deleteProfile(selfCtx(), body),
        "AUTH_CURRENT_PASSWORD_INVALID",
        403,
      );
      expect(hasher.calls.verify).toBe(0);
      expect(repo.rows.get(USER_ID)?.deleted).toBe(false);
    });

    it("answers NOT_FOUND for an account that is already deleted", async () => {
      // `404` and not the admin segment's `409 USER_DELETED`: the self view
      // filters `deleted_at`, so every other profile endpoint already answers
      // `404` for this row and this one agrees with them. No hash is bought
      // for it either — the read comes first.
      const { service, sessions, hasher } = build([userRow({ deleted: true })]);

      await expectAppError(
        () => service.deleteProfile(selfCtx(), body),
        "NOT_FOUND",
        404,
      );
      expect(sessions.revocations).toEqual([]);
      expect(hasher.calls.verify).toBe(0);
    });

    it("can only ever reach the caller's own row", async () => {
      // Structural rather than checked: the function takes no id, so there is
      // nothing for a caller to tamper with (ADR-0019 §3). The second account
      // is here to make that visible rather than to be argued about.
      const { service, repo } = build([
        userRow(),
        userRow({ id: OTHER_ID, email: "someone.else@machxi.local" }),
      ]);

      await service.deleteProfile(selfCtx(), body);

      expect(repo.rows.get(OTHER_ID)?.deleted).toBe(false);
      expect(repo.rows.get(OTHER_ID)?.status).toBe("active");
    });

    it("refuses a staff principal", async () => {
      // ADR-0028 rule 4 refuses staff self-deletion outright, and this segment
      // is not where it would be built even if it existed.
      const { service } = build([userRow()]);

      await expectAppError(
        () => service.deleteProfile(adminCtx(), body),
        "UNAUTHENTICATED",
        401,
      );
    });
  });

  /* -- D2.4: soft deletion (ADR-0028) -------------------------------------- */

  describe("remove", () => {
    it("marks the row deleted, disables it, and ends every session", async () => {
      const { service, repo, sessions, organizations } = build([userRow()]);

      await service.remove(adminCtx(), USER_ID);

      expect(repo.rows.get(USER_ID)?.deleted).toBe(true);
      expect(repo.rows.get(USER_ID)?.status).toBe("disabled");
      // And the personal organization with it, stamped with the account's own
      // `at` (ADR-0067 §2).
      expect(organizations.calls.deleted).toEqual([
        { userId: USER_ID, at: NOW },
      ]);
      // Twice: once inside the transaction, and once after it commits, for a
      // login that read the account before the delete and inserts its session
      // after the first sweep has run (`login` verifies argon2 outside any
      // transaction, which is ~130 ms of window).
      expect(sessions.revocations).toEqual([
        {
          principalId: USER_ID,
          reason: REVOKE_REASONS.accountDeleted,
          exceptSessionId: undefined,
        },
        {
          principalId: USER_ID,
          reason: REVOKE_REASONS.accountDeleted,
          exceptSessionId: undefined,
        },
      ]);
    });

    it("answers NOT_FOUND for an unknown id", async () => {
      const { service, sessions } = build([userRow()]);

      await expectAppError(
        () => service.remove(adminCtx(), OTHER_ID),
        "NOT_FOUND",
        404,
      );
      expect(sessions.revocations).toEqual([]);
    });

    it("refuses the loser of a concurrent delete, rather than reporting success", async () => {
      // The read that refuses an already-deleted subject happens outside the
      // transaction, so two callers can both pass it. `softDelete` matches
      // live rows only, and its boolean is the one thing that sees the race:
      // without it the loser writes nothing and answers `204` for a request
      // ADR-0028 says is a `409`.
      const { service, repo, sessions } = build([userRow()]);

      // Stands in for the sibling transaction committing first.
      const row = repo.rows.get(USER_ID);

      if (row !== undefined) row.deleted = true;

      await expectAppError(
        () => service.remove(adminCtx(), USER_ID),
        "USER_DELETED",
        409,
      );
      expect(sessions.revocations).toEqual([]);
    });

    it("refuses a second delete with USER_DELETED rather than moving the timestamp", async () => {
      const { service, sessions } = build([userRow({ deleted: true })]);

      await expectAppError(
        () => service.remove(adminCtx(), USER_ID),
        "USER_DELETED",
        409,
      );
      expect(sessions.revocations).toEqual([]);
    });
  });

  describe("writes aimed at a deleted account (ADR-0028)", () => {
    /**
     * `409`, not `404`: the account exists and the caller may still read it.
     * What conflicts is the state of the row — the same distinction
     * `STAFF_LAST_SUPER_ADMIN` draws.
     */
    it("refuses PATCH, so no row can be active and deleted at once", async () => {
      // The bug this closes: `update` read through `readAny`, which tolerates a
      // deleted row, so an admin could set one back to `active` without
      // clearing `deleted_at`.
      const { service, repo } = build([userRow({ deleted: true })]);

      await expectAppError(
        () => service.update(adminCtx(), USER_ID, { status: "active" }),
        "USER_DELETED",
        409,
      );

      expect(repo.rows.get(USER_ID)?.status).toBe("active");
      expect(repo.rows.get(USER_ID)?.deleted).toBe(true);
    });

    it("refuses a session revoke", async () => {
      const { service, sessions } = build([userRow({ deleted: true })]);

      await expectAppError(
        () => service.revokeSessions(adminCtx(), USER_ID),
        "USER_DELETED",
        409,
      );
      expect(sessions.revocations).toEqual([]);
    });

    it("refuses a password reset, and buys no hash doing it", async () => {
      const { service, repo, hasher } = build([userRow({ deleted: true })]);

      await expectAppError(
        () =>
          service.setPassword(adminCtx(), USER_ID, {
            password: "ResetByAdmin!2026",
            currentPassword: ACTOR_PASSWORD,
          }),
        "USER_DELETED",
        409,
      );

      expect(repo.calls.updatePasswordHash).toBe(0);
      expect(hasher.calls.hash).toBe(0);
    });

    it("still reads through getById, because an admin may open one", async () => {
      // Answering `404` for a row the admin list just showed them would be the
      // worse lie; the read path keeps the tolerance the write path drops.
      const { service } = build([userRow({ deleted: true })]);

      const resource = await service.getById(adminCtx(), USER_ID);

      expect(resource.id).toBe(USER_ID);
      expect(resource.deletedAt).not.toBeNull();
    });
  });

  /* -- D2.3: the administrative reset (ADR-0027) --------------------------- */

  describe("setPassword", () => {
    const body = {
      password: "ResetByAdmin!2026",
      currentPassword: ACTOR_PASSWORD,
    };

    it("sets the password and ends every one of the subject's sessions", async () => {
      // No exception for anybody, unlike `changePassword`: the subject proved
      // nothing here, and the plausible reason for a reset is that the account
      // is compromised (ADR-0027 rule 3).
      const { service, repo, sessions } = build([userRow()]);

      await service.setPassword(adminCtx(), USER_ID, body);

      expect(repo.rows.get(USER_ID)?.passwordHash).toBe(
        "hashed:ResetByAdmin!2026",
      );
      expect(sessions.revocations).toEqual([
        {
          principalId: USER_ID,
          reason: REVOKE_REASONS.passwordReset,
          exceptSessionId: undefined,
        },
      ]);
    });

    it("requires the acting staff member's own password", async () => {
      const { service, repo, sessions } = build([userRow()]);

      await expectAppError(
        () =>
          service.setPassword(adminCtx(), USER_ID, {
            ...body,
            currentPassword: "not-the-password",
          }),
        "AUTH_CURRENT_PASSWORD_INVALID",
        403,
      );

      expect(repo.calls.updatePasswordHash).toBe(0);
      expect(sessions.revocations).toEqual([]);
    });

    it("asks the staff service, because the actor is not of this population", async () => {
      // `ctx.principal` here is staff, so this service cannot verify the
      // credential itself; it reaches the staff module through its service
      // rather than reading the `staff` table (ADR-0009, ADR-0027 rule 1).
      const { service, actors } = build([userRow()]);

      await service.setPassword(adminCtx(), USER_ID, body);

      expect(actors.calls.verifyActorPassword).toBe(1);
    });

    it("checks the actor before the subject, so it cannot be used to probe ids", async () => {
      const { service } = build([]);

      await expectAppError(
        () =>
          service.setPassword(adminCtx(), OTHER_ID, {
            ...body,
            currentPassword: "not-the-password",
          }),
        "AUTH_CURRENT_PASSWORD_INVALID",
        403,
      );
    });

    it("answers NOT_FOUND for an unknown id once the actor verifies", async () => {
      const { service, sessions } = build([userRow()]);

      await expectAppError(
        () => service.setPassword(adminCtx(), OTHER_ID, body),
        "NOT_FOUND",
        404,
      );
      expect(sessions.revocations).toEqual([]);
    });

    it("buys no hash for a request it is going to refuse", async () => {
      const { service, hasher } = build([userRow()]);

      await expect(
        service.setPassword(adminCtx(), USER_ID, {
          ...body,
          currentPassword: "not-the-password",
        }),
      ).rejects.toBeDefined();

      expect(hasher.calls.hash).toBe(0);
    });

    it("takes no `currentPassword` of the subject, so a null hash is no obstacle", async () => {
      // The subject is not being asked to prove anything, so an account with
      // no password login (ADR-0017) can still be given one.
      const { service, repo } = build([userRow({ passwordHash: null })]);

      await service.setPassword(adminCtx(), USER_ID, body);

      expect(repo.rows.get(USER_ID)?.passwordHash).toBe(
        "hashed:ResetByAdmin!2026",
      );
    });
  });
});
