import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "../client.js";
import { sessions, staff, staffRoles, users } from "../index.js";
import { migrateFreshTestDatabase } from "./helpers.int.js";

/**
 * The migrations against real Postgres (ADR-0021).
 *
 * The unit suite checks the schema TypeScript describes; this checks what
 * Postgres ends up holding after `0000` and `0001` are replayed — the only
 * place a `casing` misconfiguration, a missing extension or a constraint that
 * silently failed to apply can be seen.
 */

let client: DbClient;

beforeAll(async () => {
  client = await migrateFreshTestDatabase();
}, 60_000);

afterAll(async () => {
  await client.close();
});

const rowsOf = async <T>(query: Parameters<DbClient["db"]["execute"]>[0]) =>
  (await client.db.execute(query)) as unknown as T[];

/**
 * Asserts a unique-violation, by SQLSTATE rather than by message.
 *
 * Drizzle wraps the driver error in one whose message is the failed SQL, so
 * `rejects.toThrow(/duplicate key/)` passes for *any* failing query — it would
 * still pass if the constraint had never been created. `23505` on the cause is
 * the constraint actually firing.
 */
const expectUniqueViolation = async (action: Promise<unknown>) => {
  await expect(action).rejects.toThrow();

  const error = await action.catch((caught: unknown) => caught);
  const cause = (error as { cause?: { code?: string } }).cause;

  expect(cause?.code).toBe("23505");
};

describe("migration 0000", () => {
  it("installs citext from the migration, not from the container init script", async () => {
    // ADR-0008: the extension lives in a migration so the local database, the
    // test database, CI and production all get it from one place. The init
    // script in docker/local deliberately creates only the empty database.
    const rows = await rowsOf<{ extname: string }>(
      sql`select extname from pg_extension where extname = 'citext'`,
    );

    expect(rows).toHaveLength(1);
  });
});

describe("migration 0001", () => {
  it("creates every table of the identity model", async () => {
    const rows = await rowsOf<{ table_name: string }>(
      sql`select table_name from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE'
          order by table_name`,
    );

    expect(rows.map((row) => row.table_name)).toEqual([
      "sessions",
      "staff",
      "staff_roles",
      "user_roles",
      "users",
    ]);
  });

  it("keeps the migration journal out of the application schema", async () => {
    // Drizzle puts `__drizzle_migrations` in its own `drizzle` schema. Worth
    // pinning: `db:reset` has to drop that schema too, and a reset that
    // forgets it leaves the journal claiming an empty database is migrated.
    const rows = await rowsOf<{ table_schema: string }>(
      sql`select table_schema from information_schema.tables
          where table_name = '__drizzle_migrations'`,
    );

    expect(rows).toEqual([{ table_schema: "drizzle" }]);
  });

  it("names every column snake_case (ADR-0006)", async () => {
    // The single check that `casing: 'snake_case'` is set on **both** the
    // drizzle client and drizzle-kit. If the two ever disagree, the runtime
    // queries address columns the migration never created.
    const rows = await rowsOf<{ table_name: string; column_name: string }>(
      sql`select table_name, column_name from information_schema.columns
          where table_schema = 'public'`,
    );

    expect(rows.length).toBeGreaterThan(0);

    const offenders = rows
      .filter((row) => !/^[a-z][a-z0-9_]*$/.test(row.column_name))
      .map((row) => `${row.table_name}.${row.column_name}`);

    expect(offenders).toEqual([]);
  });

  it("gives the email columns the citext type (ADR-0017)", async () => {
    const rows = await rowsOf<{ table_name: string; udt_name: string }>(
      sql`select table_name, udt_name from information_schema.columns
          where table_schema = 'public' and column_name = 'email'
          order by table_name`,
    );

    expect(rows).toEqual([
      { table_name: "staff", udt_name: "citext" },
      { table_name: "users", udt_name: "citext" },
    ]);
  });

  it("declares the enum labels in the order @repo/contracts declares them", async () => {
    // Label position is the sort order of an enum column, so this is what
    // `ORDER BY status` on a list endpoint follows (ADR-0014).
    const rows = await rowsOf<{ typname: string; labels: string[] }>(
      sql`select t.typname, array_agg(e.enumlabel order by e.enumsortorder) as labels
          from pg_type t join pg_enum e on e.enumtypid = t.oid
          group by t.typname order by t.typname`,
    );

    expect(
      Object.fromEntries(rows.map((row) => [row.typname, row.labels])),
    ).toEqual({
      principal_type: ["staff", "user"],
      staff_role: ["super_admin", "admin", "manager", "editor"],
      staff_status: ["active", "invited", "disabled"],
      user_role: ["customer"],
      user_status: ["active", "pending_verification", "disabled"],
    });
  });

  it("creates the indexes the auth and list paths depend on", async () => {
    const rows = await rowsOf<{ indexname: string }>(
      sql`select indexname from pg_indexes where schemaname = 'public' order by indexname`,
    );

    expect(rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        "sessions_principal_idx",
        "sessions_previous_refresh_token_hash_idx",
        "sessions_refresh_token_expires_at_idx",
        "sessions_refresh_token_hash_unique",
        "staff_created_at_idx",
        "staff_email_unique",
        "users_created_at_idx",
      ]),
    );
  });
});

describe("migration 0002", () => {
  it("replaces the users email constraint with a partial unique index", async () => {
    // ADR-0028: a plain unique constraint burns a soft-deleted address
    // forever. The index is what releases it, and its `where` clause is what
    // `onConflictDoNothing` has to name — in the repository *and* in the dev
    // seeder, which is where the missing predicate first showed up as
    // "there is no unique or exclusion constraint matching the ON CONFLICT
    // specification".
    const rows = await rowsOf<{ indexname: string; indexdef: string }>(
      sql`select indexname, indexdef from pg_indexes
          where schemaname = 'public' and tablename = 'users'
          order by indexname`,
    );

    const names = rows.map((row) => row.indexname);

    expect(names).toContain("users_email_active_unique");
    expect(names).not.toContain("users_email_unique");

    const partial = rows.find(
      (row) => row.indexname === "users_email_active_unique",
    );

    expect(partial?.indexdef).toMatch(/UNIQUE/i);
    expect(partial?.indexdef).toMatch(/WHERE \(deleted_at IS NULL\)/i);
  });

  it("allows two rows to share an address when only one is live", async () => {
    const email = "rejoin@machxi.test";

    const [deleted] = await client.db
      .insert(users)
      .values({ email, deletedAt: new Date() })
      .returning({ id: users.id });

    await expect(
      client.db.insert(users).values({ email }),
    ).resolves.not.toThrow();

    expect(deleted?.id).toEqual(expect.any(String));
  });

  it("still refuses two live rows with the same address", async () => {
    // The half of uniqueness that has to survive: releasing a deleted
    // address must not release a live one.
    const email = "still.unique@machxi.test";

    await client.db.insert(users).values({ email });

    await expectUniqueViolation(client.db.insert(users).values({ email }));
  });

  it("refuses a second *deleted* row only when a live one exists", async () => {
    // Two deleted rows with one address are legal — the index does not see
    // them at all — which is what makes repeated delete-and-rejoin cycles
    // possible rather than a slow-motion unique violation.
    const email = "twice.deleted@machxi.test";
    const deletedAt = new Date();

    await client.db.insert(users).values({ email, deletedAt });

    await expect(
      client.db.insert(users).values({ email, deletedAt }),
    ).resolves.not.toThrow();
  });
});

describe("citext", () => {
  it("makes email uniqueness case-insensitive (ADR-0017)", async () => {
    await client.db.insert(staff).values({
      email: "Ada.Lovelace@machxi.test",
      passwordHash: "not-a-real-hash",
      firstName: "Ada",
      lastName: "Lovelace",
    });

    await expectUniqueViolation(
      client.db.insert(staff).values({
        email: "ada.lovelace@machxi.test",
        passwordHash: "not-a-real-hash",
        firstName: "Impostor",
        lastName: "Lovelace",
      }),
    );
  });

  it("finds an account regardless of the case it was typed in", async () => {
    const found = await client.db.query.staff.findFirst({
      where: (table, { eq }) => eq(table.email, "ADA.LOVELACE@MACHXI.TEST"),
    });

    // No `lower()` anywhere in the query — that is the whole reason for citext.
    expect(found?.firstName).toBe("Ada");
  });

  it("keeps the two populations independent (ADR-0017)", async () => {
    // The same person may be both a staff member and a customer; uniqueness is
    // within a population, not across it.
    await expect(
      client.db.insert(users).values({ email: "ada.lovelace@machxi.test" }),
    ).resolves.not.toThrow();
  });
});

describe("defaults", () => {
  it("fills id, status and the timestamps without the caller saying so", async () => {
    const [row] = await client.db
      .insert(users)
      .values({ email: "defaults@machxi.test" })
      .returning();

    expect(row?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(row?.status).toBe("active");
    expect(row?.createdAt).toBeInstanceOf(Date);
    expect(row?.updatedAt).toBeInstanceOf(Date);
    expect(row?.lastLoginAt).toBeNull();
    expect(row?.deletedAt).toBeNull();
    // Nullable so the future passwordless path needs no migration (ADR-0018).
    expect(row?.passwordHash).toBeNull();
  });
});

describe("sessions", () => {
  it("accepts a session for a principal it has no foreign key to", async () => {
    const [account] = await client.db
      .insert(users)
      .values({ email: "session-owner@machxi.test" })
      .returning({ id: users.id });

    const [session] = await client.db
      .insert(sessions)
      .values({
        principalType: "user",
        principalId: account?.id ?? "",
        refreshTokenHash: "hash-one",
        refreshTokenExpiresAt: new Date(Date.now() + 60_000),
        ip: "203.0.113.7",
        userAgent: "vitest",
      })
      .returning();

    expect(session?.revokedAt).toBeNull();
    expect(session?.previousRefreshTokenHash).toBeNull();
    expect(session?.lastUsedAt).toBeInstanceOf(Date);
    expect(session?.ip).toBe("203.0.113.7");
  });

  it("refuses a second session with the same refresh token hash", async () => {
    // The uniqueness that makes "look the session up by token hash" a lookup
    // rather than a scan (ADR-0018).
    await expectUniqueViolation(
      client.db.insert(sessions).values({
        principalType: "staff",
        principalId: "00000000-0000-7000-8000-000000000000",
        refreshTokenHash: "hash-one",
        refreshTokenExpiresAt: new Date(Date.now() + 60_000),
      }),
    );
  });

  it("stores an IPv6 address in the inet column", async () => {
    const [session] = await client.db
      .insert(sessions)
      .values({
        principalType: "user",
        principalId: "00000000-0000-7000-8000-000000000001",
        refreshTokenHash: "hash-two",
        refreshTokenExpiresAt: new Date(Date.now() + 60_000),
        ip: "2001:db8::1",
      })
      .returning({ ip: sessions.ip });

    expect(session?.ip).toBe("2001:db8::1");
  });
});

describe("role grants", () => {
  const addStaff = async (email: string) => {
    const [row] = await client.db
      .insert(staff)
      .values({
        email,
        passwordHash: "not-a-real-hash",
        firstName: "Gene",
        lastName: "Grantee",
      })
      .returning({ id: staff.id });

    return row?.id ?? "";
  };

  it("makes a repeated grant a no-op rather than a duplicate row", async () => {
    const staffId = await addStaff("repeat-grant@machxi.test");

    await client.db.insert(staffRoles).values({ staffId, role: "manager" });
    await client.db
      .insert(staffRoles)
      .values({ staffId, role: "manager" })
      .onConflictDoNothing();

    const rows = await client.db
      .select()
      .from(staffRoles)
      .where(eq(staffRoles.staffId, staffId));

    expect(rows).toHaveLength(1);
  });

  it("deletes a staff member's grants with the account, but keeps the granter's", async () => {
    const granterId = await addStaff("granter@machxi.test");
    const granteeId = await addStaff("grantee@machxi.test");

    await client.db
      .insert(staffRoles)
      .values({ staffId: granteeId, role: "editor", grantedBy: granterId });

    // `set null` on granted_by: removing the person who granted a role must
    // not remove the role itself.
    await client.db.delete(staff).where(eq(staff.id, granterId));

    const [afterGranterGone] = await client.db
      .select()
      .from(staffRoles)
      .where(eq(staffRoles.staffId, granteeId));

    expect(afterGranterGone?.role).toBe("editor");
    expect(afterGranterGone?.grantedBy).toBeNull();

    // `cascade` on staff_id: the grant has no meaning without the account.
    await client.db.delete(staff).where(eq(staff.id, granteeId));

    const remaining = await client.db
      .select()
      .from(staffRoles)
      .where(eq(staffRoles.staffId, granteeId));

    expect(remaining).toHaveLength(0);
  });
});

describe("ping", () => {
  it("resolves against a reachable database (ADR-0003, ADR-0016)", async () => {
    await expect(client.ping()).resolves.toBeUndefined();
  });
});
