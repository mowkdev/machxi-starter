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
/**
 * An actor id with hex *letters* in it, for the case-spelling rule below.
 *
 * The other ids in this file are all digits, so `toUpperCase()` on them is a
 * no-op — a test written against one of those would pass whether or not the
 * comparison is case-insensitive, which is how the first attempt at this test
 * proved nothing.
 */
const MIXED_CASE_ACTOR_ID = "0199a1f4-4c2e-7c53-9c62-3e0f9d0f7f11";
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

    // A no-op: the fakes are single-threaded, so there is nothing to
    // serialise. That the *real* service takes the lock before it reads is a
    // property only the database can demonstrate, and the integration suite
    // is where it is exercised.
    lockRoleInvariant: () => {
      calls.lockRoleInvariant += 1;

      return Promise.resolve();
    },

    remove: (id: string) => Promise.resolve(rows.delete(id)),

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

/**
 * The acting `admin`'s own row.
 *
 * Needed since D2.3 because the credential endpoints read the actor back and
 * verify the password they present, so a context alone no longer describes a
 * caller — `ACTOR_ID` has to exist in the table too.
 */
const actorRow = (): FakeStaffRow => ({
  id: ACTOR_ID,
  email: "actor@machxi.local",
  passwordHash: "hashed:actor-secret",
  firstName: "Alex",
  lastName: "Actor",
  status: "active",
  roles: ["admin"],
});

/** What {@link actorRow} presents on a credential endpoint. */
const ACTOR_PASSWORD = "actor-secret";

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

        // `superCtx`, because an `admin` is stopped earlier and by a different
        // rule — see "protecting a super admin" below.
        await expectAppError(
          () =>
            service.update(superCtx(), SUPER_ADMIN_ID, { status: "disabled" }),
          "STAFF_LAST_SUPER_ADMIN",
          409,
        );
      });

      it("leaves the row untouched when it refuses", async () => {
        // The check runs inside the transaction and before the writes, so a
        // refusal must not have half-applied the patch.
        const { service, repo } = build([superAdminRow()]);

        await expect(
          service.update(superCtx(), SUPER_ADMIN_ID, {
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

    describe("protecting a super admin (ADR-0017 §Invariants)", () => {
      it("refuses an admin who tries to disable one", async () => {
        // The escalation the role rule alone did not close: an `admin` cannot
        // take the role away, but could neutralise its holder.
        const { service, repo } = build([superAdminRow(), adminRow()]);
        const second = {
          ...superAdminRow(),
          id: "aaaaaaaa-0000-7000-8000-aaaaaaaaaaaa",
        };

        repo.rows.set(second.id, second);

        await expectAppError(
          () => service.update(ctx(), SUPER_ADMIN_ID, { status: "disabled" }),
          "FORBIDDEN",
          403,
        );
        expect(repo.rows.get(SUPER_ADMIN_ID)?.status).toBe("active");
      });

      it("refuses an admin who tries to revoke one's sessions", async () => {
        // Without this an `admin` could keep every super admin permanently
        // logged out by calling this on a loop.
        const { service, sessions } = build([superAdminRow(), adminRow()]);

        await expectAppError(
          () => service.revokeSessions(ctx(), SUPER_ADMIN_ID),
          "FORBIDDEN",
          403,
        );
        expect(sessions.revocations).toEqual([]);
      });

      it("lets a super admin do both", async () => {
        const second = {
          ...adminRow(),
          roles: ["super_admin"] as StaffRole[],
        };
        const { service } = build([superAdminRow(), second]);

        await expect(
          service.update(superCtx(), ADMIN_ID, { status: "disabled" }),
        ).resolves.toMatchObject({ status: "disabled" });
        await expect(
          service.revokeSessions(superCtx(), SUPER_ADMIN_ID),
        ).resolves.toBeUndefined();
      });

      it("lets an admin rename one, which removes no standing", async () => {
        const { service } = build([superAdminRow()]);

        await expect(
          service.update(ctx(), SUPER_ADMIN_ID, { firstName: "Renamed" }),
        ).resolves.toMatchObject({ firstName: "Renamed" });
      });

      it("lets an admin re-activate one", async () => {
        // Restoring standing is not removing it, so the rule stays out of it.
        const dormant = {
          ...superAdminRow(),
          status: "disabled" as StaffStatus,
        };
        const { service } = build([dormant, adminRow()]);

        await expect(
          service.update(ctx(), SUPER_ADMIN_ID, { status: "active" }),
        ).resolves.toMatchObject({ status: "active" });
      });

      it("does not fire for a target who is not a super admin", async () => {
        const { service } = build([superAdminRow(), adminRow()]);

        await expect(
          service.revokeSessions(ctx(), ADMIN_ID),
        ).resolves.toBeUndefined();
      });
    });

    describe("a role change ends the account's sessions", () => {
      // `authorize` reads roles from the token's claims (ADR-0018), so a
      // demotion that leaves the sessions alive does not take effect for up to
      // `JWT_ACCESS_TTL` — long enough for its subject to call this endpoint
      // and undo it. Revoking is what makes the change real.
      it("revokes when the role set changes", async () => {
        const { service, sessions } = build([superAdminRow(), adminRow()]);

        await service.update(ctx(), ADMIN_ID, { roles: ["editor"] });

        expect(sessions.revocations).toEqual([
          { principalId: ADMIN_ID, reason: REVOKE_REASONS.rolesChanged },
        ]);
      });

      it("does not revoke when the same set is re-sent in another order", async () => {
        const both = {
          ...adminRow(),
          roles: ["admin", "editor"] as StaffRole[],
        };
        const { service, sessions } = build([superAdminRow(), both]);

        await service.update(ctx(), ADMIN_ID, { roles: ["editor", "admin"] });

        expect(sessions.revocations).toEqual([]);
      });

      it("does not revoke when the patch leaves the roles alone", async () => {
        const { service, sessions } = build([adminRow()]);

        await service.update(ctx(), ADMIN_ID, { firstName: "Adelaide" });

        expect(sessions.revocations).toEqual([]);
      });

      it("reports a disable as a disable when both change at once", async () => {
        // One revocation, and the audit trail should name the stronger reason.
        const { service, sessions } = build([superAdminRow(), adminRow()]);

        await service.update(ctx(), ADMIN_ID, {
          roles: ["editor"],
          status: "disabled",
        });

        expect(sessions.revocations).toEqual([
          { principalId: ADMIN_ID, reason: REVOKE_REASONS.accountDisabled },
        ]);
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
        {
          principalId: ADMIN_ID,
          reason: REVOKE_REASONS.adminRevoke,
          exceptSessionId: undefined,
        },
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

  /* -- D2.3: credential self-service and administrative reset (ADR-0027) --- */

  describe("getProfile", () => {
    it("reads the caller's own account, with no id to pass", async () => {
      const { service } = build([actorRow(), adminRow()]);

      const profile = await service.getProfile(ctx());

      expect(profile.id).toBe(ACTOR_ID);
      expect(profile.email).toBe("actor@machxi.local");
    });

    it("answers NOT_FOUND when the caller's own row is gone", async () => {
      // Reachable only inside the access token's life, since `authenticate`
      // verifies the session and not the account (ADR-0018).
      const { service } = build([adminRow()]);

      await expectAppError(() => service.getProfile(ctx()), "NOT_FOUND", 404);
    });
  });

  describe("updateProfile", () => {
    it("writes the caller's own names and returns the re-read row", async () => {
      const { service, repo } = build([actorRow()]);

      const updated = await service.updateProfile(ctx(), {
        firstName: "Alexandra",
      });

      expect(updated.firstName).toBe("Alexandra");
      expect(updated.lastName).toBe("Actor");
      expect(repo.rows.get(ACTOR_ID)?.firstName).toBe("Alexandra");
    });

    it("cannot touch another account, because it takes no id", async () => {
      // The ADR-0019 section 3 ownership rule made structural: there is no
      // argument for a caller to tamper with.
      const { service, repo } = build([actorRow(), adminRow()]);

      await service.updateProfile(ctx(), { firstName: "Alexandra" });

      expect(repo.rows.get(ADMIN_ID)?.firstName).toBe("Ada");
    });
  });

  describe("changePassword", () => {
    it("rotates the password and spares the caller's own session", async () => {
      const { service, repo, sessions } = build([actorRow()]);

      await service.changePassword(ctx(), {
        currentPassword: ACTOR_PASSWORD,
        newPassword: "BrandNewPassword!1",
      });

      expect(repo.rows.get(ACTOR_ID)?.passwordHash).toBe(
        "hashed:BrandNewPassword!1",
      );
      // Every other session ends - that is what a password change is for -
      // and this one does not, because the caller just proved they own it.
      expect(sessions.revocations).toEqual([
        {
          principalId: ACTOR_ID,
          reason: REVOKE_REASONS.passwordChanged,
          exceptSessionId: "session-1",
        },
      ]);
    });

    it("refuses a wrong current password with 403 and writes nothing", async () => {
      const { service, repo, sessions } = build([actorRow()]);

      await expectAppError(
        () =>
          service.changePassword(ctx(), {
            currentPassword: "not-the-password",
            newPassword: "BrandNewPassword!1",
          }),
        "AUTH_CURRENT_PASSWORD_INVALID",
        403,
      );

      expect(repo.rows.get(ACTOR_ID)?.passwordHash).toBe("hashed:actor-secret");
      expect(sessions.revocations).toEqual([]);
    });

    it("buys no hash for a request it is going to refuse", async () => {
      // The verify happens before the new password is hashed, which is one
      // argon2 operation not taken from the pool login shares (ADR-0020).
      const { service, hasher } = build([actorRow()]);

      await expect(
        service.changePassword(ctx(), {
          currentPassword: "not-the-password",
          newPassword: "BrandNewPassword!1",
        }),
      ).rejects.toBeDefined();

      expect(hasher.calls.hash).toBe(0);
    });
  });

  describe("setPassword", () => {
    const body = {
      password: "ResetByAdmin!2026",
      currentPassword: ACTOR_PASSWORD,
    };

    it("sets the subject's password and ends every one of their sessions", async () => {
      const { service, repo, sessions } = build([actorRow(), adminRow()]);

      await service.setPassword(ctx(), ADMIN_ID, body);

      expect(repo.rows.get(ADMIN_ID)?.passwordHash).toBe(
        "hashed:ResetByAdmin!2026",
      );
      // No exception for anybody: the subject proved nothing, and the
      // plausible reason for a reset is that the account is compromised
      // (ADR-0027 rule 3). The reason is distinct from a self-service change
      // so the audit trail can tell the two apart.
      expect(sessions.revocations).toEqual([
        {
          principalId: ADMIN_ID,
          reason: REVOKE_REASONS.passwordReset,
          exceptSessionId: undefined,
        },
      ]);
    });

    it("refuses an actor who cannot re-present their own password", async () => {
      // ADR-0027 rule 1: without this, fifteen minutes of a compromised admin
      // token is enough to set a new password on every operator it outranks.
      const { service, repo, sessions } = build([actorRow(), adminRow()]);

      await expectAppError(
        () =>
          service.setPassword(ctx(), ADMIN_ID, {
            ...body,
            currentPassword: "not-the-password",
          }),
        "AUTH_CURRENT_PASSWORD_INVALID",
        403,
      );

      expect(repo.rows.get(ADMIN_ID)?.passwordHash).toBe("hashed:secret");
      expect(sessions.revocations).toEqual([]);
    });

    it("checks the actor before the subject, so it cannot be used to probe ids", async () => {
      // A wrong actor password answers the same 403 whether or not the id
      // exists; checking the subject first would make the endpoint an
      // account-existence oracle for somebody who cannot use it at all.
      const { service } = build([actorRow()]);

      await expectAppError(
        () =>
          service.setPassword(ctx(), SUPER_ADMIN_ID, {
            ...body,
            currentPassword: "not-the-password",
          }),
        "AUTH_CURRENT_PASSWORD_INVALID",
        403,
      );
    });

    it("answers NOT_FOUND for an unknown subject once the actor verifies", async () => {
      const { service, sessions } = build([actorRow()]);

      await expectAppError(
        () => service.setPassword(ctx(), ADMIN_ID, body),
        "NOT_FOUND",
        404,
      );
      expect(sessions.revocations).toEqual([]);
    });

    it("refuses an admin setting a super admin's password", async () => {
      // Rewriting somebody's credential is removing their standing in the most
      // complete way available, so it carries the same rank rule as disabling
      // or signing them out (ADR-0017 Invariants, ADR-0027 rule 2).
      const { service, repo, sessions } = build([actorRow(), superAdminRow()]);

      await expectAppError(
        () => service.setPassword(ctx(), SUPER_ADMIN_ID, body),
        "FORBIDDEN",
        403,
      );

      expect(repo.rows.get(SUPER_ADMIN_ID)?.passwordHash).toBe("hashed:secret");
      expect(sessions.revocations).toEqual([]);
    });

    it("serialises the rank decision against a concurrent promotion", async () => {
      // The rank rule is decided twice: cheaply outside the transaction so a
      // refusal costs no hash, and again inside it, after
      // `lockRoleInvariant`, because a decision made against a snapshot the
      // write does not share is not a decision (ADR-0017 §Serialising).
      const { repo, sessions } = build([actorRow(), adminRow()]);
      const hasher = createFakeHasher();

      // Stands in for a super admin promoting the target while the actor is
      // paying for argon2: the row changes after the first read, before the
      // second.
      const promoting = createStaffService({
        repository: repo.repository,
        hasher: {
          hash: (password) => {
            const row = repo.rows.get(ADMIN_ID);

            if (row !== undefined) row.roles = ["super_admin"];

            return hasher.hasher.hash(password);
          },
          verify: hasher.hasher.verify,
        },
        sessions: sessions.sessions,
        transaction: (fn) => fn(undefined as never),
        now: () => NOW,
      });

      await expectAppError(
        () => promoting.setPassword(ctx(), ADMIN_ID, body),
        "FORBIDDEN",
        403,
      );

      expect(repo.rows.get(ADMIN_ID)?.passwordHash).toBe("hashed:secret");
      expect(sessions.revocations).toEqual([]);
    });

    it("lets a super admin set another super admin's password", async () => {
      const { service, repo } = build([actorRow(), superAdminRow()]);

      await service.setPassword(superCtx(), SUPER_ADMIN_ID, body);

      expect(repo.rows.get(SUPER_ADMIN_ID)?.passwordHash).toBe(
        "hashed:ResetByAdmin!2026",
      );
    });
  });

  describe("remove", () => {
    it("deletes the row and revokes the account's sessions", async () => {
      const { service, repo, sessions } = build([actorRow(), adminRow()]);

      await service.remove(ctx(), ADMIN_ID);

      expect(repo.rows.has(ADMIN_ID)).toBe(false);
      // Twice, and both are deliberate. The first runs inside the transaction,
      // because `sessions` has no foreign key to `staff` (ADR-0018) and
      // deleting the principal would otherwise leave live-looking rows behind.
      // The second runs after the commit, for the login that read this account
      // before it and inserts its session after: `authenticate` verifies the
      // session and never the principal, so that session would be a deleted
      // operator holding `admin` until its access token expired.
      expect(sessions.revocations).toEqual([
        {
          principalId: ADMIN_ID,
          reason: REVOKE_REASONS.accountDeleted,
          exceptSessionId: undefined,
        },
        {
          principalId: ADMIN_ID,
          reason: REVOKE_REASONS.accountDeleted,
          exceptSessionId: undefined,
        },
      ]);
    });

    it("refuses a staff member deleting themselves", async () => {
      // The one delete whose actor vanishes mid-request, and the only one that
      // interacts with the last-super-admin invariant from the inside
      // (ADR-0028 rule 4). Plain 403, no new code.
      const { service, repo, sessions } = build([actorRow()]);

      await expectAppError(
        () => service.remove(ctx(), ACTOR_ID),
        "FORBIDDEN",
        403,
      );

      expect(repo.rows.has(ACTOR_ID)).toBe(true);
      expect(sessions.revocations).toEqual([]);
    });

    it("refuses self-deletion however the id is spelled", async () => {
      // `z.uuid()` accepts uppercase and Postgres matches it against the row,
      // so a comparison between two strings is not a comparison between two
      // ids. `idSchema` lower-cases on the way in and this compares the row's
      // own id inside the transaction; either alone would have closed the
      // bypass the D2.4 review found, and both are cheap.
      const { service, repo } = build([
        { ...actorRow(), id: MIXED_CASE_ACTOR_ID },
      ]);
      const mixedCtx = contextFor(
        staffPrincipal(MIXED_CASE_ACTOR_ID, ["admin"]),
      );
      const shouted = MIXED_CASE_ACTOR_ID.toUpperCase();

      // The premise, asserted rather than assumed: an all-digit id would make
      // this test vacuous.
      expect(shouted).not.toBe(MIXED_CASE_ACTOR_ID);

      await expectAppError(
        () => service.remove(mixedCtx, shouted),
        "FORBIDDEN",
        403,
      );

      expect(repo.rows.has(MIXED_CASE_ACTOR_ID)).toBe(true);
    });

    it("refuses self-deletion before anything else, invariant included", async () => {
      // A super admin who is the last one, deleting themselves: the truthful
      // answer is "you may never do this", not "not right now" — so the rule
      // that cannot be satisfied by any state change goes first, which is the
      // order `update` applies to privilege versus invariant.
      const { service, repo } = build([
        { ...actorRow(), roles: ["super_admin"] },
      ]);

      await expectAppError(
        () => service.remove(superCtx(), ACTOR_ID),
        "FORBIDDEN",
        403,
      );

      expect(repo.calls.lockRoleInvariant).toBe(0);
    });

    it("refuses an admin deleting a super admin", async () => {
      // Deleting a super admin is the most complete removal of standing there
      // is, so it carries the guard that already covers disabling and forced
      // logout (ADR-0017 §Invariants).
      const { service, repo, sessions } = build([actorRow(), superAdminRow()]);

      await expectAppError(
        () => service.remove(ctx(), SUPER_ADMIN_ID),
        "FORBIDDEN",
        403,
      );

      expect(repo.rows.has(SUPER_ADMIN_ID)).toBe(true);
      expect(sessions.revocations).toEqual([]);
    });

    it("refuses the last active super admin, behind the advisory lock", async () => {
      // Two concurrent deletes of two different super admins would otherwise
      // each count the other as the survivor and both commit, leaving a
      // deployment with no super admin and no way back through the API.
      const { service, repo, sessions } = build([actorRow(), superAdminRow()]);

      await expectAppError(
        () => service.remove(superCtx(), SUPER_ADMIN_ID),
        "STAFF_LAST_SUPER_ADMIN",
        409,
      );

      expect(repo.calls.lockRoleInvariant).toBe(1);
      expect(repo.rows.has(SUPER_ADMIN_ID)).toBe(true);
      expect(sessions.revocations).toEqual([]);
    });

    it("allows it when another active super admin survives", async () => {
      const { service, repo } = build([
        actorRow(),
        superAdminRow(),
        {
          ...adminRow(),
          id: "44444444-4444-7444-8444-444444444444",
          email: "second.root@machxi.local",
          roles: ["super_admin"],
        },
      ]);

      await service.remove(superCtx(), SUPER_ADMIN_ID);

      expect(repo.rows.has(SUPER_ADMIN_ID)).toBe(false);
    });

    it("counts only *active* super admins as survivors", async () => {
      // A disabled super admin cannot sign in, so it is no answer to "who is
      // left" — the invariant is about an active one existing (ADR-0017).
      const { service } = build([
        actorRow(),
        superAdminRow(),
        {
          ...adminRow(),
          id: "44444444-4444-7444-8444-444444444444",
          email: "disabled.root@machxi.local",
          status: "disabled",
          roles: ["super_admin"],
        },
      ]);

      await expectAppError(
        () => service.remove(superCtx(), SUPER_ADMIN_ID),
        "STAFF_LAST_SUPER_ADMIN",
        409,
      );
    });

    it("answers NOT_FOUND for an unknown id", async () => {
      const { service, sessions } = build([actorRow()]);

      await expectAppError(
        () => service.remove(ctx(), ADMIN_ID),
        "NOT_FOUND",
        404,
      );
      expect(sessions.revocations).toEqual([]);
    });
  });

  describe("verifyActorPassword", () => {
    it("resolves for the caller's own password", async () => {
      const { service } = build([actorRow()]);

      await expect(
        service.verifyActorPassword(ctx(), ACTOR_PASSWORD),
      ).resolves.toBeUndefined();
    });

    it("answers a caller whose own row has gone the same 403, not a 404", async () => {
      // The caller cannot prove anything either way, so the two answers must
      // not differ — and this runs from the users module too, where a "Staff
      // member not found" would read as a statement about the subject of
      // `POST /admin/users/:id/password` and be exactly wrong.
      const { service } = build([adminRow()]);

      await expectAppError(
        () => service.verifyActorPassword(ctx(), ACTOR_PASSWORD),
        "AUTH_CURRENT_PASSWORD_INVALID",
        403,
      );
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
