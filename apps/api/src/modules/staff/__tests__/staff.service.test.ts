import type { ListStaffQuery, StaffRole, StaffStatus } from "@repo/contracts";
import { createLogger } from "@repo/logger";
import { beforeEach, describe, expect, it } from "vitest";

import type { LimitedHasher } from "../../../core/auth/index.js";
import {
  createRequestContext,
  type Principal,
  type RequestContext,
} from "../../../core/context/index.js";
import { isAppError } from "../../../core/errors/index.js";
import { REVOKE_REASONS } from "../../auth/index.js";
import type {
  NewStaffInput,
  StaffColumnPatch,
  StaffRecord,
  StaffRepository,
} from "../staff.repository.js";
import { createStaffService } from "../staff.service.js";

/**
 * Staff administration against fake repositories (ADR-0021 §Unit).
 *
 * No database and no Express. What is under test is the part a guard cannot
 * see: the ADR-0017 invariant that an active `super_admin` survives every
 * edit, and the ADR-0018 rule that disabling an account ends its sessions in
 * the same breath. Everything else here is plumbing that the integration
 * suite exercises for real.
 */

const SUPER_ADMIN_ID = "11111111-1111-7111-8111-111111111111";
const ADMIN_ID = "22222222-2222-7222-8222-222222222222";
const ACTOR_ID = "33333333-3333-7333-8333-333333333333";
const NOW = new Date("2026-08-18T12:00:00.000Z");

/* ── fakes ────────────────────────────────────────────────────────────────── */

interface FakeStaffRow {
  readonly id: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  status: StaffStatus;
  roles: readonly StaffRole[];
}

const toRecord = (row: FakeStaffRow): StaffRecord => ({
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
const createFakeRepository = (seed: FakeStaffRow[]) => {
  const rows = new Map(seed.map((row) => [row.id, { ...row }]));
  const calls = { replaceRoles: 0, updateColumns: 0 };
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
        status: "active",
        roles: [],
      };

      rows.set(row.id, row);

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

    updateLastLoginAt: () => Promise.resolve(),
    updatePasswordHash: () => Promise.resolve(),
  };

  return { repository, rows, calls, grants } as const;
};

/** Cheap by design: argon2's correctness belongs to `@repo/crypto`. */
const createFakeHasher = () => {
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

const createFakeSessions = () => {
  const revocations: { principalId: string; reason: string }[] = [];

  return {
    revocations,
    sessions: {
      revokeSessionsFor: (
        _ctx: RequestContext,
        input: { principalId: string; reason: string },
      ) => {
        revocations.push({
          principalId: input.principalId,
          reason: input.reason,
        });

        return Promise.resolve(1);
      },
    },
  } as const;
};

/* ── harness ──────────────────────────────────────────────────────────────── */

const staffPrincipal = (
  id: string,
  roles: readonly StaffRole[],
): Principal => ({
  kind: "staff",
  id,
  roles,
  sessionId: "session-1",
});

const contextFor = (principal: Principal | null): RequestContext => {
  const ctx = createRequestContext({
    requestId: "req-1",
    logger: createLogger({ level: "silent", name: "test" }),
  });

  ctx.principal = principal;

  return ctx;
};

const superAdminRow = (): FakeStaffRow => ({
  id: SUPER_ADMIN_ID,
  email: "root@machxi.local",
  passwordHash: "hashed:secret",
  firstName: "Root",
  lastName: "Admin",
  status: "active",
  roles: ["super_admin"],
});

const adminRow = (): FakeStaffRow => ({
  id: ADMIN_ID,
  email: "admin@machxi.local",
  passwordHash: "hashed:secret",
  firstName: "Ada",
  lastName: "Admin",
  status: "active",
  roles: ["admin"],
});

const build = (seed: FakeStaffRow[]) => {
  const repo = createFakeRepository(seed);
  const hasher = createFakeHasher();
  const sessions = createFakeSessions();

  const service = createStaffService({
    repository: repo.repository,
    hasher: hasher.hasher,
    sessions: sessions.sessions,
    // The service composes repositories, and the fakes share no state that a
    // rollback would have to undo, so "one transaction" is just "run it".
    transaction: (fn) => fn(undefined as never),
    now: () => NOW,
  });

  return { service, repo, hasher, sessions } as const;
};

/** An `admin` caller — enough for every endpoint, per `authorize("admin")`. */
const ctx = () => contextFor(staffPrincipal(ACTOR_ID, ["admin"]));
/** A `super_admin` caller, needed for any change to `super_admin` membership. */
const superCtx = () =>
  contextFor(staffPrincipal(ACTOR_ID, ["admin", "super_admin"]));

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

/* ── tests ────────────────────────────────────────────────────────────────── */

describe("createStaffService", () => {
  describe("list", () => {
    it("returns a page that echoes the resolved query for `meta`", async () => {
      const { service } = build([superAdminRow(), adminRow()]);

      const page = await service.list(ctx(), {
        offset: 0,
        limit: 20,
        sort: [{ field: "createdAt", direction: "desc" }],
        filters: [],
      });

      expect(page.items).toHaveLength(2);
      expect(page).toMatchObject({ total: 2, offset: 0, limit: 20 });
      expect(page.sort).toEqual([{ field: "createdAt", direction: "desc" }]);
    });

    it("maps rows through the mapper, so no password hash reaches the page", async () => {
      const { service } = build([superAdminRow()]);

      const page = await service.list(ctx(), {
        offset: 0,
        limit: 20,
        sort: [],
        filters: [],
      });

      expect(page.items[0]).not.toHaveProperty("passwordHash");
      expect(JSON.stringify(page)).not.toContain("hashed:");
    });
  });

  describe("getById", () => {
    it("returns the resource", async () => {
      const { service } = build([adminRow()]);

      await expect(service.getById(ctx(), ADMIN_ID)).resolves.toMatchObject({
        id: ADMIN_ID,
        email: "admin@machxi.local",
        roles: ["admin"],
      });
    });

    it("answers NOT_FOUND for an unknown id", async () => {
      const { service } = build([]);

      await expectAppError(
        () => service.getById(ctx(), ADMIN_ID),
        "NOT_FOUND",
        404,
      );
    });
  });

  describe("create", () => {
    it("hashes the password and grants the requested roles", async () => {
      const { service, hasher, repo } = build([]);

      const created = await service.create(ctx(), {
        email: "new@machxi.local",
        password: "InitialPassword!1",
        firstName: "Nina",
        lastName: "New",
        roles: ["manager", "editor"],
      });

      expect(hasher.calls.hash).toBe(1);
      expect(created.roles).toEqual(["manager", "editor"]);
      expect(created.status).toBe("active");
      expect(repo.rows.get(created.id)?.passwordHash).toBe(
        "hashed:InitialPassword!1",
      );
    });

    it("records who granted the roles", async () => {
      // `staff_roles.granted_by` exists to answer "who made this person an
      // admin" (ADR-0017); it can only come from `ctx.principal`.
      const { service, repo } = build([]);

      const created = await service.create(ctx(), {
        email: "new@machxi.local",
        password: "InitialPassword!1",
        firstName: "Nina",
        lastName: "New",
        roles: ["editor"],
      });

      expect(repo.grants).toEqual([
        { staffId: created.id, grantedBy: ACTOR_ID },
      ]);
    });

    it("answers STAFF_EMAIL_TAKEN for a duplicate address", async () => {
      const { service } = build([adminRow()]);

      await expectAppError(
        () =>
          service.create(ctx(), {
            email: "admin@machxi.local",
            password: "InitialPassword!1",
            firstName: "Ada",
            lastName: "Twin",
            roles: ["editor"],
          }),
        "STAFF_EMAIL_TAKEN",
        409,
      );
    });

    it("refuses a caller who is not a staff principal", async () => {
      // Only reachable through a router mounted with the wrong guard, and it
      // answers 401 rather than crashing (ADR-0019, amended step 8).
      const { service } = build([]);

      await expectAppError(
        () =>
          service.create(contextFor(null), {
            email: "new@machxi.local",
            password: "InitialPassword!1",
            firstName: "Nina",
            lastName: "New",
            roles: ["editor"],
          }),
        "UNAUTHENTICATED",
        401,
      );
    });
  });

  describe("update", () => {
    it("replaces the role set", async () => {
      const { service } = build([adminRow()]);

      const updated = await service.update(ctx(), ADMIN_ID, {
        roles: ["manager"],
      });

      expect(updated.roles).toEqual(["manager"]);
    });

    it("leaves the roles alone when the patch does not mention them", async () => {
      const { service, repo } = build([adminRow()]);

      await service.update(ctx(), ADMIN_ID, { firstName: "Adelaide" });

      expect(repo.calls.replaceRoles).toBe(0);
      expect(repo.rows.get(ADMIN_ID)?.roles).toEqual(["admin"]);
    });

    it("answers NOT_FOUND for an unknown id", async () => {
      const { service } = build([]);

      await expectAppError(
        () => service.update(ctx(), ADMIN_ID, { firstName: "Ghost" }),
        "NOT_FOUND",
        404,
      );
    });

    describe("the last super admin (ADR-0017)", () => {
      it("refuses to demote the only active super admin", async () => {
        const { service } = build([superAdminRow(), adminRow()]);

        await expectAppError(
          () =>
            service.update(superCtx(), SUPER_ADMIN_ID, { roles: ["admin"] }),
          "STAFF_LAST_SUPER_ADMIN",
          409,
        );
      });

      it("refuses to disable the only active super admin", async () => {
        const { service } = build([superAdminRow()]);

        await expectAppError(
          () => service.update(ctx(), SUPER_ADMIN_ID, { status: "disabled" }),
          "STAFF_LAST_SUPER_ADMIN",
          409,
        );
      });

      it("leaves the row untouched when it refuses", async () => {
        // The check runs inside the transaction and before the writes, so a
        // refusal must not have half-applied the patch.
        const { service, repo } = build([superAdminRow()]);

        await expect(
          service.update(ctx(), SUPER_ADMIN_ID, {
            status: "disabled",
            firstName: "Renamed",
          }),
        ).rejects.toThrow();

        expect(repo.rows.get(SUPER_ADMIN_ID)).toMatchObject({
          status: "active",
          firstName: "Root",
        });
      });

      it("allows the demotion once a second active super admin exists", async () => {
        const second = { ...adminRow(), roles: ["super_admin"] as StaffRole[] };
        const { service } = build([superAdminRow(), second]);

        await expect(
          service.update(superCtx(), SUPER_ADMIN_ID, { roles: ["admin"] }),
        ).resolves.toMatchObject({ roles: ["admin"] });
      });

      it("does not count a disabled super admin as the survivor", async () => {
        const dormant = {
          ...adminRow(),
          roles: ["super_admin"] as StaffRole[],
          status: "disabled" as StaffStatus,
        };
        const { service } = build([superAdminRow(), dormant]);

        await expectAppError(
          () =>
            service.update(superCtx(), SUPER_ADMIN_ID, { roles: ["admin"] }),
          "STAFF_LAST_SUPER_ADMIN",
          409,
        );
      });

      it("does not fire when the edit keeps the role and the status", async () => {
        const { service } = build([superAdminRow()]);

        await expect(
          service.update(ctx(), SUPER_ADMIN_ID, { firstName: "Renamed" }),
        ).resolves.toMatchObject({ firstName: "Renamed" });
      });

      it("does not fire for an account that is not a super admin", async () => {
        const { service } = build([superAdminRow(), adminRow()]);

        await expect(
          service.update(ctx(), ADMIN_ID, { status: "disabled" }),
        ).resolves.toMatchObject({ status: "disabled" });
      });
    });

    describe("granting super_admin (ADR-0017 §Invariants)", () => {
      it("refuses an admin who tries to promote somebody to super admin", async () => {
        const { service } = build([superAdminRow(), adminRow()]);

        await expectAppError(
          () =>
            service.update(ctx(), ADMIN_ID, {
              roles: ["admin", "super_admin"],
            }),
          "FORBIDDEN",
          403,
        );
      });

      it("refuses an admin who tries to promote themselves", async () => {
        // The escalation the rule exists for: `authorize("admin")` is what
        // lets them reach this endpoint, and their own id is a legal `:id`.
        const own = { ...adminRow(), id: ACTOR_ID };
        const { service, repo } = build([superAdminRow(), own]);

        await expectAppError(
          () => service.update(ctx(), ACTOR_ID, { roles: ["super_admin"] }),
          "FORBIDDEN",
          403,
        );
        expect(repo.rows.get(ACTOR_ID)?.roles).toEqual(["admin"]);
      });

      it("refuses an admin who tries to revoke it from somebody else", async () => {
        const second = { ...adminRow(), roles: ["super_admin"] as StaffRole[] };
        const { service } = build([superAdminRow(), second]);

        await expectAppError(
          () => service.update(ctx(), ADMIN_ID, { roles: ["admin"] }),
          "FORBIDDEN",
          403,
        );
      });

      it("lets a super admin grant it", async () => {
        const { service } = build([superAdminRow(), adminRow()]);

        await expect(
          service.update(superCtx(), ADMIN_ID, { roles: ["super_admin"] }),
        ).resolves.toMatchObject({ roles: ["super_admin"] });
      });

      it("lets an admin edit a super admin without touching the roles", async () => {
        // Only a *change* to the membership is refused; an ordinary edit of a
        // super admin's profile is not an escalation.
        const { service } = build([superAdminRow()]);

        await expect(
          service.update(ctx(), SUPER_ADMIN_ID, { firstName: "Renamed" }),
        ).resolves.toMatchObject({ firstName: "Renamed" });
      });

      it("lets an admin re-send a role set that already holds it", async () => {
        const { service } = build([superAdminRow()]);

        await expect(
          service.update(ctx(), SUPER_ADMIN_ID, {
            roles: ["super_admin", "editor"],
          }),
        ).resolves.toMatchObject({ roles: ["super_admin", "editor"] });
      });

      it("refuses an admin who creates a staff member as super admin", async () => {
        const { service, repo } = build([]);

        await expectAppError(
          () =>
            service.create(ctx(), {
              email: "new@machxi.local",
              password: "InitialPassword!1",
              firstName: "Nina",
              lastName: "New",
              roles: ["super_admin"],
            }),
          "FORBIDDEN",
          403,
        );
        expect(repo.rows.size).toBe(0);
      });

      it("lets a super admin create one", async () => {
        const { service } = build([]);

        await expect(
          service.create(superCtx(), {
            email: "new@machxi.local",
            password: "InitialPassword!1",
            firstName: "Nina",
            lastName: "New",
            roles: ["super_admin"],
          }),
        ).resolves.toMatchObject({ roles: ["super_admin"] });
      });
    });

    describe("the session cascade (ADR-0018)", () => {
      it("revokes every session when an active account is disabled", async () => {
        const { service, sessions } = build([superAdminRow(), adminRow()]);

        await service.update(ctx(), ADMIN_ID, { status: "disabled" });

        expect(sessions.revocations).toEqual([
          {
            principalId: ADMIN_ID,
            reason: REVOKE_REASONS.accountDisabled,
          },
        ]);
      });

      it("revokes for any non-active status, not only `disabled`", async () => {
        const { service, sessions } = build([superAdminRow(), adminRow()]);

        await service.update(ctx(), ADMIN_ID, { status: "invited" });

        expect(sessions.revocations).toHaveLength(1);
      });

      it("does not revoke when the account was already inactive", async () => {
        // Nothing changed, so there is nothing to end — and re-revoking would
        // overwrite the original reason in the audit trail.
        const dormant = { ...adminRow(), status: "disabled" as StaffStatus };
        const { service, sessions } = build([superAdminRow(), dormant]);

        await service.update(ctx(), ADMIN_ID, { status: "disabled" });

        expect(sessions.revocations).toEqual([]);
      });

      it("does not revoke when the status is not part of the patch", async () => {
        const { service, sessions } = build([adminRow()]);

        await service.update(ctx(), ADMIN_ID, { firstName: "Adelaide" });

        expect(sessions.revocations).toEqual([]);
      });

      it("does not revoke when the account is re-activated", async () => {
        const dormant = { ...adminRow(), status: "disabled" as StaffStatus };
        const { service, sessions } = build([dormant]);

        await service.update(ctx(), ADMIN_ID, { status: "active" });

        expect(sessions.revocations).toEqual([]);
      });
    });
  });

  describe("revokeSessions", () => {
    it("revokes with the admin reason", async () => {
      const { service, sessions } = build([adminRow()]);

      await service.revokeSessions(ctx(), ADMIN_ID);

      expect(sessions.revocations).toEqual([
        { principalId: ADMIN_ID, reason: REVOKE_REASONS.adminRevoke },
      ]);
    });

    it("answers NOT_FOUND for an unknown id rather than a silent success", async () => {
      // Revoking an account with no live session is legitimately a no-op, so
      // "there is no such account" must not look the same as "there was
      // nothing to do".
      const { service, sessions } = build([]);

      await expectAppError(
        () => service.revokeSessions(ctx(), ADMIN_ID),
        "NOT_FOUND",
        404,
      );
      expect(sessions.revocations).toEqual([]);
    });
  });
});

describe("the fake repository", () => {
  // Guards the guard: several cases above prove nothing if the fake's unique
  // index or its super-admin count silently stopped working.
  let repo: ReturnType<typeof createFakeRepository>;

  beforeEach(() => {
    repo = createFakeRepository([superAdminRow(), adminRow()]);
  });

  it("refuses a duplicate email", async () => {
    await expect(
      repo.repository.create({
        email: "admin@machxi.local",
        passwordHash: "x",
        firstName: "A",
        lastName: "B",
      }),
    ).resolves.toBeUndefined();
  });

  it("excludes the row being edited from the super-admin count", async () => {
    await expect(
      repo.repository.countOtherActiveSuperAdmins(SUPER_ADMIN_ID),
    ).resolves.toBe(0);
  });
});
