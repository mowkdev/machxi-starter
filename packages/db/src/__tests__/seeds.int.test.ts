import { and, count, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { SUPER_ADMIN_ROLE } from "@repo/contracts";
import type { PasswordHasher } from "@repo/crypto";

import { baseSeeders, devSeeders, runSeeders } from "../../seeds/run.js";
import {
  DEV_PASSWORD,
  DEV_STAFF,
  DEV_TEAM_ORGANIZATION,
  DEV_USERS,
} from "../../seeds/dev/fixtures.js";
import type { DbClient } from "../client.js";
import {
  organizationMemberships,
  organizations,
  staff,
  staffRoles,
  userRoles,
  users,
} from "../index.js";
import { migrateFreshTestDatabase, testHasher } from "./helpers.int.js";

/**
 * The seeders against real Postgres (ADR-0021: "tests exercise the real seed
 * path"). These call `runSeeders` with the same lists `pnpm db:seed` uses, so
 * an idempotency bug cannot hide behind a test-only copy of the logic.
 *
 * Idempotency is the property under test throughout: there is no seed journal
 * (ADR-0008), so "safe to re-run" is a claim only a second run can check.
 */

const SUPER_ADMIN_EMAIL = "seeded-super-admin@machxi.test";

let client: DbClient;
let hasher: PasswordHasher;

const seedBase = (password: string, email = SUPER_ADMIN_EMAIL) =>
  runSeeders(baseSeeders, {
    db: client.db,
    hasher,
    env: {
      nodeEnv: "test",
      superAdminEmail: email,
      superAdminPassword: password,
    },
  });

const seedDev = () =>
  runSeeders(devSeeders, {
    db: client.db,
    hasher,
    env: {
      nodeEnv: "test",
      superAdminEmail: SUPER_ADMIN_EMAIL,
      superAdminPassword: "irrelevant-to-the-fixtures",
    },
  });

const countOf = async (
  table:
    | typeof staff
    | typeof users
    | typeof staffRoles
    | typeof userRoles
    | typeof organizations
    | typeof organizationMemberships,
) => {
  const [row] = await client.db.select({ value: count() }).from(table);

  return row?.value ?? 0;
};

beforeAll(async () => {
  client = await migrateFreshTestDatabase();
  hasher = testHasher();
  // The seeders log through `SeedContext.log`, which the runner routes to
  // stdout; silence it so the vitest report stays readable.
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe("001-super-admin", () => {
  it("creates one active super admin holding the role that bypasses guards", async () => {
    await seedBase("first-password-12345");

    const account = await client.db.query.staff.findFirst({
      where: eq(staff.email, SUPER_ADMIN_EMAIL),
    });

    expect(account?.status).toBe("active");
    expect(account?.lastLoginAt).toBeNull();

    const grants = await client.db
      .select()
      .from(staffRoles)
      .where(eq(staffRoles.staffId, account?.id ?? ""));

    expect(grants.map((grant) => grant.role)).toEqual([SUPER_ADMIN_ROLE]);
    // Nobody granted it — the seed did (ADR-0017 §Invariants).
    expect(grants[0]?.grantedBy).toBeNull();
  });

  it("hashes the password with the hasher the API verifies against (ADR-0008)", async () => {
    const account = await client.db.query.staff.findFirst({
      where: eq(staff.email, SUPER_ADMIN_EMAIL),
    });

    await expect(
      hasher.verify(account?.passwordHash ?? "", "first-password-12345"),
    ).resolves.toBe(true);
  });

  it("yields exactly one super admin when run twice (ADR-0021)", async () => {
    await seedBase("first-password-12345");

    expect(await countOf(staff)).toBe(1);
    expect(await countOf(staffRoles)).toBe(1);
  });

  it("does not rewrite the password of an account that already exists", async () => {
    const before = await client.db.query.staff.findFirst({
      where: eq(staff.email, SUPER_ADMIN_EMAIL),
    });

    await seedBase("a-completely-different-password");

    const after = await client.db.query.staff.findFirst({
      where: eq(staff.email, SUPER_ADMIN_EMAIL),
    });

    // A seeder that upserted credentials could reset a live super admin's
    // password to a stale value from somebody's `.env`, and `db:seed` has to
    // stay safe to re-run in production.
    expect(after?.passwordHash).toBe(before?.passwordHash);
    await expect(
      hasher.verify(after?.passwordHash ?? "", "first-password-12345"),
    ).resolves.toBe(true);
  });

  it("re-grants the role to an account that lost it", async () => {
    const account = await client.db.query.staff.findFirst({
      where: eq(staff.email, SUPER_ADMIN_EMAIL),
    });

    await client.db
      .delete(staffRoles)
      .where(eq(staffRoles.staffId, account?.id ?? ""));

    await seedBase("first-password-12345");

    expect(await countOf(staffRoles)).toBe(1);
  });

  it("matches an existing account case-insensitively rather than duplicating it", async () => {
    await seedBase("first-password-12345", SUPER_ADMIN_EMAIL.toUpperCase());

    expect(await countOf(staff)).toBe(1);
  });

  it("skips, without creating anything, when the credentials are absent", async () => {
    await runSeeders(baseSeeders, {
      db: client.db,
      hasher,
      env: {
        nodeEnv: "test",
        superAdminEmail: undefined,
        superAdminPassword: undefined,
      },
    });

    expect(await countOf(staff)).toBe(1);
  });
});

describe("dev fixtures", () => {
  it("creates the staff and user fixtures with their documented roles", async () => {
    await seedDev();

    const roles = await client.db
      .select({ email: staff.email, role: staffRoles.role })
      .from(staff)
      .innerJoin(staffRoles, eq(staffRoles.staffId, staff.id));

    for (const fixture of DEV_STAFF) {
      expect(roles).toContainEqual({
        email: fixture.email,
        role: fixture.role,
      });
    }

    expect(await countOf(users)).toBe(DEV_USERS.length);
    expect(await countOf(userRoles)).toBe(DEV_USERS.length);
  });

  it("covers every user status, so the login and list paths have fixtures", async () => {
    const rows = await client.db
      .select({ status: users.status })
      .from(users)
      .orderBy(users.status);

    expect(rows.map((row) => row.status)).toEqual([
      "active",
      "pending_verification",
      "disabled",
    ]);
  });

  it("signs the fixtures in with the committed password", async () => {
    const manager = await client.db.query.staff.findFirst({
      where: eq(staff.email, DEV_STAFF[0].email),
    });

    await expect(
      hasher.verify(manager?.passwordHash ?? "", DEV_PASSWORD),
    ).resolves.toBe(true);
  });

  it("adds nothing on a second run", async () => {
    const before = [
      await countOf(staff),
      await countOf(staffRoles),
      await countOf(users),
      await countOf(userRoles),
      await countOf(organizations),
      await countOf(organizationMemberships),
    ];

    await seedDev();

    expect([
      await countOf(staff),
      await countOf(staffRoles),
      await countOf(users),
      await countOf(userRoles),
      await countOf(organizations),
      await countOf(organizationMemberships),
    ]).toEqual(before);
  });
});

/**
 * The invariant ADR-0067 §2 rests everything on: **every live user has exactly
 * one personal organization**, on every path that creates a user. The seeders
 * are one of the three paths, so the fixtures are not exempt from it — and
 * "exactly one" is a claim only a count can keep.
 */
describe("dev organizations (ADR-0067 §2)", () => {
  it("gives every live user exactly one personal organization, owned by them", async () => {
    const live = await client.db
      .select({ id: users.id })
      .from(users)
      .where(isNull(users.deletedAt));

    expect(live.length).toBe(DEV_USERS.length);

    for (const user of live) {
      const personal = await client.db
        .select({ id: organizations.id })
        .from(organizations)
        .where(
          and(
            eq(organizations.createdBy, user.id),
            eq(organizations.kind, "personal"),
            isNull(organizations.deletedAt),
          ),
        );

      expect(personal).toHaveLength(1);

      const membership = await client.db
        .select({ role: organizationMemberships.role })
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, personal[0]?.id ?? ""),
            eq(organizationMemberships.userId, user.id),
          ),
        );

      expect(membership.map((row) => row.role)).toEqual(["owner"]);
    }
  });

  it("creates the one team organization Postman addresses by slug", async () => {
    const organization = await client.db.query.organizations.findFirst({
      where: eq(organizations.slug, DEV_TEAM_ORGANIZATION.slug),
    });

    expect(organization?.kind).toBe("team");
    expect(organization?.name).toBe(DEV_TEAM_ORGANIZATION.name);

    const owner = await client.db.query.users.findFirst({
      where: eq(users.email, DEV_TEAM_ORGANIZATION.ownerEmail),
    });

    expect(organization?.createdBy).toBe(owner?.id);

    const membership = await client.db
      .select({ role: organizationMemberships.role })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, organization?.id ?? ""),
          eq(organizationMemberships.userId, owner?.id ?? ""),
        ),
      );

    expect(membership.map((row) => row.role)).toEqual(["owner"]);
  });

  it("counts one organization per user plus the team one", async () => {
    // Stated as a total as well as per user: a seeder that created two for
    // somebody would still pass the per-user loop above if it also lost one
    // elsewhere.
    expect(await countOf(organizations)).toBe(DEV_USERS.length + 1);
    expect(await countOf(organizationMemberships)).toBe(DEV_USERS.length + 1);
  });
});
