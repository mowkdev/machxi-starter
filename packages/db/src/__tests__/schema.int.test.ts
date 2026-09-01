import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "../client.js";
import {
  sessions,
  staff,
  staffRoles,
  staffSettings,
  userSettings,
  users,
} from "../index.js";
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

    // The whole public schema, not only `0001`'s share of it: an exact list is
    // what makes a table arriving without a decision behind it visible here.
    // `staff_settings` and `user_settings` came with `0003` (ADR-0045),
    // `audit_events` with `0006` (ADR-0058) and `impersonation_handoffs` with
    // `0007` (ADR-0057 §2) — which is also this suite's proof that the latest
    // migration applies from nothing, since the list is taken after a fresh
    // replay of every committed migration.
    expect(rows.map((row) => row.table_name)).toEqual([
      "audit_events",
      "impersonation_handoffs",
      "sessions",
      "staff",
      "staff_roles",
      "staff_settings",
      "user_roles",
      "user_settings",
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
      // `audit_actor_type` came with `0006` (`D13.2`, ADR-0058): the same two
      // labels as `principal_type` and deliberately a second type, so that the
      // day an audit actor needs a third label it cannot widen the column a
      // live session is discriminated by.
      audit_actor_type: ["staff", "user"],
      // `grid_density` came with `0005` (`D11.6`, ADR-0053 §2 as amended):
      // the density is a column and a type, not a key in the `grids` jsonb.
      // Two labels, and comfortable is first because it is the default.
      grid_density: ["comfortable", "compact"],
      // `locale` and `theme` came with `0003` (ADR-0045); `locale` is the one
      // enum here expected to grow, and `D7.1`'s `"lv"` did *append*
      // (`0004_locale_lv`, ADR-0046) — this list is what says so, because a
      // value inserted rather than appended would reorder every sort by it.
      locale: ["en", "lv"],
      principal_type: ["staff", "user"],
      staff_role: ["super_admin", "admin", "manager", "editor"],
      staff_status: ["active", "invited", "disabled"],
      theme: ["light", "dark", "system"],
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

describe("migration 0003 — settings", () => {
  const addStaff = async (email: string) => {
    const [row] = await client.db
      .insert(staff)
      .values({
        email,
        passwordHash: "not-a-real-hash",
        firstName: "Sett",
        lastName: "Ings",
      })
      .returning({ id: staff.id });

    return row?.id ?? "";
  };

  const addUser = async (email: string) => {
    const [row] = await client.db
      .insert(users)
      .values({ email })
      .returning({ id: users.id });

    return row?.id ?? "";
  };

  it("defaults a row to system, en, comfortable and no grids at all (ADR-0045)", async () => {
    // The defaults are the floor, and they are the database's rather than the
    // service's: a row inserted with nothing but its principal is the same
    // answer `GET /settings` gives a principal who has no row.
    const staffId = await addStaff("defaults@machxi.test");

    const [row] = await client.db
      .insert(staffSettings)
      .values({ staffId })
      .returning();

    expect(row?.theme).toBe("system");
    expect(row?.locale).toBe("en");
    // `D11.6`: the column default and `DEFAULT_GRID_DENSITY` are one
    // declaration (ADR-0023), so a row nobody has written and a `GET` before
    // any write cannot disagree about how the grid is packed.
    expect(row?.gridDensity).toBe("comfortable");
    expect(row?.grids).toEqual({});
  });

  it("holds an arrangement in the jsonb column and returns it unchanged", async () => {
    // The one column whose shape the database does not check. What it must do
    // is give back exactly what was stored, because the client validates on
    // the way out and a value the database reshaped would fail that check.
    const staffId = await addStaff("grids@machxi.test");
    const grids = {
      staff: {
        v: 1 as const,
        sizing: { email: 240 },
        order: ["email"],
        hidden: [],
      },
    };

    const [row] = await client.db
      .insert(staffSettings)
      .values({ staffId, grids })
      .returning();

    expect(row?.grids).toEqual(grids);
  });

  it("allows one settings row per principal, in each population", async () => {
    const staffId = await addStaff("one-row@machxi.test");
    const userId = await addUser("one-row@machxi.test");

    await client.db.insert(staffSettings).values({ staffId });
    await client.db.insert(userSettings).values({ userId });

    // The `unique` is what makes "this principal's settings" a single row and
    // the service's upsert a single statement.
    await expectUniqueViolation(
      client.db.insert(staffSettings).values({ staffId }),
    );
    await expectUniqueViolation(
      client.db.insert(userSettings).values({ userId }),
    );
  });

  it("keeps the two populations' rows in separate tables, sharing an address", async () => {
    // A staff member and a customer with the same email are different
    // accounts (ADR-0017), and the row above proves the settings follow the
    // account rather than the address: two rows, two tables, one string.
    const rows = await client.db
      .select()
      .from(staffSettings)
      .innerJoin(staff, eq(staffSettings.staffId, staff.id))
      .where(eq(staff.email, "one-row@machxi.test"));

    expect(rows).toHaveLength(1);
  });

  it("takes the settings row with a hard-deleted staff account", async () => {
    // The whole of ADR-0045's deletion story, and the reason the pair has a
    // real foreign key where `sessions` could not: the database sweeps, so
    // ADR-0028's hard delete needs no settings code and no hard-delete path
    // added later can forget it.
    const staffId = await addStaff("cascade@machxi.test");

    await client.db.insert(staffSettings).values({ staffId });
    await client.db.delete(staff).where(eq(staff.id, staffId));

    const remaining = await client.db
      .select()
      .from(staffSettings)
      .where(eq(staffSettings.staffId, staffId));

    expect(remaining).toHaveLength(0);
  });

  it("keeps a soft-deleted user's row, because their account stays", async () => {
    // Users have no hard delete (ADR-0028): the account is retained by
    // design, so the arrangement should still be there if a restore path ever
    // exists. The cascade above is not a contradiction — nothing deletes the
    // `users` row for it to fire on.
    const userId = await addUser("soft-deleted@machxi.test");

    await client.db.insert(userSettings).values({ userId });
    await client.db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, userId));

    const remaining = await client.db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId));

    expect(remaining).toHaveLength(1);
  });

  it("refuses a settings row for a principal that does not exist", async () => {
    // The constraint `sessions.principal_id` cannot carry. An orphan here is
    // not merely unusable, it is unwritable.
    await expect(
      client.db
        .insert(staffSettings)
        .values({ staffId: "00000000-0000-7000-8000-00000000dead" }),
    ).rejects.toThrow();
  });
});

describe("ping", () => {
  it("resolves against a reachable database (ADR-0003, ADR-0016)", async () => {
    await expect(client.ping()).resolves.toBeUndefined();
  });
});
