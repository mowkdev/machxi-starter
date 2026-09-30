import { and, eq, exists, gt, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client.js";
import {
  federatedIdentities,
  organizationInvitations,
  organizationMemberships,
  organizations,
  setTenantScope,
  sessions,
  staff,
  staffRoles,
  staffSettings,
  userSettings,
  users,
} from "../index.js";
import { TENANT_OWNED_TABLES } from "../testing.js";
import { readTestDatabaseUrl } from "../tooling/env.js";
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

/**
 * A `users` row that satisfies `users_active_email_verified_check` — the
 * `0017` constraint that makes "every `active` user has a proven address" a
 * database rule (ADR-0073 §8).
 *
 * Every fixture in this file is an `active` account by default and none of
 * them is *about* verification, so the stamp is furniture: spelled once here
 * rather than at a dozen call sites, and overridable by any caller that means
 * something by it. A test that wants an unproven address states
 * `emailVerifiedAt: null` with a `status` the constraint permits — which is
 * exactly what the two cases in `migration 0017` below do.
 */
const userRow = <T extends { readonly email: string }>(values: T) =>
  ({ emailVerifiedAt: new Date(), ...values }) as T & {
    emailVerifiedAt: Date;
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

describe("migrations 0009 and 0010", () => {
  it("installs pg_trgm, the second extension a migration owns", async () => {
    // ADR-0060 §3 puts it exactly where `citext` is, and for the same reason:
    // one place, every environment. It ships in its own file ahead of the
    // indexes because `USING gin (… gin_trgm_ops)` cannot name an operator
    // class the database does not have.
    const rows = await rowsOf<{ extname: string }>(
      sql`select extname from pg_extension where extname = 'pg_trgm'`,
    );

    expect(rows).toHaveLength(1);
  });

  it("indexes every column the list allow-lists admit (ADR-0060 §3)", async () => {
    const rows = await rowsOf<{ indexname: string }>(
      sql`select indexname from pg_indexes where schemaname = 'public' order by indexname`,
    );

    expect(rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        "users_updated_at_idx",
        "users_email_idx",
        "users_first_name_idx",
        "users_last_name_idx",
        "users_status_idx",
        "users_last_login_at_idx",
        "users_deleted_at_idx",
        "users_email_trgm_idx",
        "users_first_name_trgm_idx",
        "users_last_name_trgm_idx",
        "staff_updated_at_idx",
        "staff_first_name_idx",
        "staff_last_name_idx",
        "staff_status_idx",
        "staff_last_login_at_idx",
        "staff_email_trgm_idx",
        "staff_first_name_trgm_idx",
        "staff_last_name_trgm_idx",
        "sessions_impersonated_by_staff_id_idx",
        "audit_events_acting_as_idx",
        "audit_events_occurred_at_idx",
      ]),
    );
  });

  it("rebuilds the two created_at indexes as the pagination key", async () => {
    // `(created_at, id)`, because `applyListQuery` appends `asc(id)` to every
    // ORDER BY: the composite *is* the key, and the old single-column index
    // was a prefix of it.
    const rows = await rowsOf<{ indexdef: string }>(
      sql`select indexdef from pg_indexes
          where schemaname = 'public'
            and indexname in ('users_created_at_idx', 'staff_created_at_idx')
          order by indexname`,
    );

    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.indexdef).toContain("created_at, id");
  });

  it("makes the trgm indexes reachable from the search the API writes", async () => {
    /*
     * The measurement ADR-0060 §3's amendment records, kept as a test rather
     * than as a paragraph: on a `citext` column the GIN index is created but
     * `email ilike $1` cannot use it — citext's own `~~*` is in no trgm
     * operator family — while `email::text ilike $1` can. `toSearchCondition`
     * writes the cast for exactly this reason, and if that ever regresses the
     * index stays green while the query goes back to a sequential scan.
     */
    const rows = await rowsOf<{ "QUERY PLAN": string }>(
      sql`explain (costs off) select id from users where email::text ilike '%anna%'`,
    );
    const plan = rows.map((row) => row["QUERY PLAN"]).join(" ");

    // `enable_seqscan` is left alone: on an empty table the planner chooses a
    // sequential scan whatever is available, so what this pins is the
    // *operator* — `(email)::text ~~*`, the text one `gin_trgm_ops` knows,
    // rather than citext's `~~*`, which it does not. That is the half of the
    // pairing that can regress in code; the index half is asserted above.
    expect(plan).toContain("(email)::text ~~*");
    expect(plan).not.toContain("::citext");
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
      // The one token table behind every mail flow came with `0014`
      // (`D18.1`, ADR-0071 §1) — one table with a `purpose` column rather
      // than four with the same five columns.
      "account_tokens",
      "audit_events",
      // A user's external identities came with `0016` (`D19.1`, ADR-0072
      // §1) — the passwordless path `users.password_hash` was left nullable
      // for.
      "federated_identities",
      "impersonation_handoffs",
      // The tenant and what it owns came with `0011` (`D15.1`, ADR-0067 §2).
      "organization_invitations",
      "organization_memberships",
      "organizations",
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
    //
    // `pg_tables`, not `information_schema.tables`, since `D14.4`: this client
    // is the **application** role (ADR-0061 §1), and `information_schema` shows
    // only what the current role has a privilege on — the journal is the
    // owner's and the application role has none on it, so the standard view
    // reports nothing and the assertion would read as "the table does not
    // exist". The catalog view is not privilege-filtered and answers the
    // question this test is actually asking, which is where the table lives.
    const rows = await rowsOf<{ schemaname: string }>(
      sql`select schemaname from pg_tables
          where tablename = '__drizzle_migrations'`,
    );

    expect(rows).toEqual([{ schemaname: "drizzle" }]);
  });

  it("does not show the journal to the application role at all", async () => {
    // The other half of the same fact, and the one worth an assertion of its
    // own (ADR-0061 §1): the role the API connects as has no privilege on the
    // migration journal, so a query through it cannot read — let alone
    // rewrite — the record of what has been applied.
    const rows = await rowsOf<{ table_schema: string }>(
      sql`select table_schema from information_schema.tables
          where table_name = '__drizzle_migrations'`,
    );

    expect(rows).toEqual([]);
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
      // What the provider reported at the link (ADR-0072 §1) — informational,
      // and citext anyway so the one place it is shown beside the account's
      // own address does not disagree about case.
      { table_name: "federated_identities", udt_name: "citext" },
      // An invitation names an address, not an account (ADR-0067 §2), and it
      // must match the invitee's however either was typed — the same reason
      // the two account tables use the type.
      { table_name: "organization_invitations", udt_name: "citext" },
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
      // `federated_provider` came with `0016` (`D19.1`, ADR-0072 §1). One
      // label; a second provider appends one.
      federated_provider: ["google"],
      // `grid_density` came with `0005` (`D11.6`, ADR-0053 §2 as amended):
      // the density is a column and a type, not a key in the `grids` jsonb.
      // Two labels, and comfortable is first because it is the default.
      grid_density: ["comfortable", "compact"],
      // `locale` and `theme` came with `0003` (ADR-0045); `locale` is the one
      // enum here expected to grow, and `D7.1`'s `"lv"` did *append*
      // (`0004_locale_lv`, ADR-0046) — this list is what says so, because a
      // value inserted rather than appended would reorder every sort by it.
      locale: ["en", "lv"],
      // The organization enums came with `0011` (`D15.1`, ADR-0067 §2).
      // `organization_role` is deliberately not `user_role`: an account role
      // and a membership role have different lifetimes, and the day one grows
      // a label the other must not.
      organization_kind: ["personal", "team"],
      organization_role: ["owner", "admin", "member"],
      principal_type: ["staff", "user"],
      staff_role: ["super_admin", "admin", "manager", "editor"],
      staff_status: ["active", "invited", "disabled"],
      theme: ["light", "dark", "system"],
      // `token_purpose` came with `0014` (`D18.1`, ADR-0071 §1). Expected to
      // grow — a fifth flow is a fifth label — and `ALTER TYPE … ADD VALUE`
      // appends, so no row and no sort order moves when it does — and the
      // fifth did, `federated_login` by `0015` (`D19.1`, ADR-0072 §2), in a
      // migration of its own (ADR-0060 §5).
      token_purpose: [
        "verify_email",
        "reset_password",
        "change_email",
        "staff_onboarding",
        "federated_login",
      ],
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
        // The credential index of `0013` (ADR-0067 §2, amended 2026-09-04),
        // beside the two the same shape already produced. Nothing reads it in
        // D15; the constraint is what makes it a lookup when something does.
        "organization_invitations_token_hash_unique",
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
      .values(userRow({ email, deletedAt: new Date() }))
      .returning({ id: users.id });

    await expect(
      client.db.insert(users).values(userRow({ email })),
    ).resolves.not.toThrow();

    expect(deleted?.id).toEqual(expect.any(String));
  });

  it("still refuses two live rows with the same address", async () => {
    // The half of uniqueness that has to survive: releasing a deleted
    // address must not release a live one.
    const email = "still.unique@machxi.test";

    await client.db.insert(users).values(userRow({ email }));

    await expectUniqueViolation(
      client.db.insert(users).values(userRow({ email })),
    );
  });

  it("refuses a second *deleted* row only when a live one exists", async () => {
    // Two deleted rows with one address are legal — the index does not see
    // them at all — which is what makes repeated delete-and-rejoin cycles
    // possible rather than a slow-motion unique violation.
    const email = "twice.deleted@machxi.test";
    const deletedAt = new Date();

    await client.db.insert(users).values(userRow({ email, deletedAt }));

    await expect(
      client.db.insert(users).values(userRow({ email, deletedAt })),
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
      client.db
        .insert(users)
        .values(userRow({ email: "ada.lovelace@machxi.test" })),
    ).resolves.not.toThrow();
  });
});

describe("defaults", () => {
  it("fills id, status and the timestamps without the caller saying so", async () => {
    const [row] = await client.db
      .insert(users)
      .values(userRow({ email: "defaults@machxi.test" }))
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
      .values(userRow({ email: "session-owner@machxi.test" }))
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
      .values(userRow({ email }))
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

describe("migration 0013 — the invitation's single-use token", () => {
  /**
   * The column added 2026-09-04 while the D15 window was open (ADR-0067 §2,
   * the operator's answer to the finding `D15.1` escalated). **Nothing in D15
   * reads it** — acceptance matches by address — so what is asserted here is
   * the shape the mail deliverable will require: every row carries a hash, no
   * two rows carry the same one, and "used once" is the row's own timestamps
   * rather than a second column.
   */
  const invitation = async (email: string, tokenHash: string) => {
    const [owner] = await client.db
      .insert(users)
      .values(userRow({ email: `owner-${email}` }))
      .returning({ id: users.id });

    const [organization] = await client.db
      .insert(organizations)
      .values({
        slug: `token-${email.replace(/[^a-z0-9]/g, "-")}`,
        name: "Token Team",
        kind: "team",
        createdBy: owner?.id ?? "",
      })
      .returning({ id: organizations.id });

    return client.db
      .insert(organizationInvitations)
      .values({
        organizationId: organization?.id ?? "",
        email,
        role: "member",
        invitedBy: owner?.id ?? "",
        tokenHash,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
  };

  it("stores a hash on every row and refuses a second row carrying the same one", async () => {
    const [row] = await invitation("invitee-one@machxi.test", "token-hash-one");

    expect(row?.tokenHash).toBe("token-hash-one");
    // The four terminal columns are what the consume below reads; a fresh row
    // is `pending` because all of them are null (ADR-0067 §2 — no `status`).
    expect(row?.acceptedAt).toBeNull();
    expect(row?.declinedAt).toBeNull();
    expect(row?.revokedAt).toBeNull();

    // The uniqueness that makes "look the invitation up by token hash" a
    // lookup rather than a scan, exactly as `sessions.refresh_token_hash` is.
    await expectUniqueViolation(
      invitation("invitee-two@machxi.test", "token-hash-one"),
    );
  });

  it("refuses a row with no token at all", async () => {
    // `not null`, so the accept path never grows a "this row has no token"
    // branch. Written as raw SQL because the drizzle types already refuse the
    // omission — this asserts that Postgres does too, which is what a fork
    // hand-loading rows meets.
    const [row] = await invitation(
      "invitee-four@machxi.test",
      "token-hash-four",
    );

    const insertWithoutToken = async () =>
      client.db.execute(
        sql`insert into organization_invitations
              (id, organization_id, email, role, invited_by, expires_at)
            values (gen_random_uuid(), ${row?.organizationId ?? ""},
                    'no-token@machxi.test', 'member', ${row?.invitedBy ?? ""}, now())`,
      );

    await expect(insertWithoutToken()).rejects.toThrow();

    const error = await insertWithoutToken().catch((caught: unknown) => caught);

    expect((error as { cause?: { code?: string } }).cause?.code).toBe("23502");
  });

  /**
   * The atomic consume the accept path will take, verbatim from ADR-0067 §2 —
   * `impersonation_handoffs`' `update … where consumed_at is null returning`
   * (ADR-0057 §2) over the terminal stamps this table already carries, plus
   * the `exists` on a **live** organization.
   *
   * That last clause is not decoration. `organization_id` cascades on a hard
   * delete only, so an invitation outlives its organization's soft delete
   * (`D15.1` logged exactly this for the accept path), and a consume without
   * it grants membership in a deleted tenant.
   */
  const consume = (tokenHash: string, { guarded = true } = {}) =>
    client.db
      .update(organizationInvitations)
      .set({ acceptedAt: new Date() })
      .where(
        and(
          eq(organizationInvitations.tokenHash, tokenHash),
          isNull(organizationInvitations.acceptedAt),
          isNull(organizationInvitations.declinedAt),
          isNull(organizationInvitations.revokedAt),
          gt(organizationInvitations.expiresAt, new Date()),
          guarded
            ? exists(
                client.db
                  .select({ live: sql`1` })
                  .from(organizations)
                  .where(
                    and(
                      eq(
                        organizations.id,
                        organizationInvitations.organizationId,
                      ),
                      isNull(organizations.deletedAt),
                    ),
                  ),
              )
            : undefined,
        ),
      )
      .returning({ id: organizationInvitations.id });

  it("is single-use through the row's own timestamps, with no column for it", async () => {
    const [row] = await invitation(
      "invitee-three@machxi.test",
      "token-hash-three",
    );

    // A second column for "used" would be a second source of truth for "this
    // invitation is over", which is what the missing `status` column was
    // refused for.
    const first = await consume("token-hash-three");
    const replay = await consume("token-hash-three");

    expect(first.map((consumed) => consumed.id)).toEqual([row?.id]);
    expect(replay).toEqual([]);
  });

  it("is consumed exactly once when two consumes race", async () => {
    // The property the sequential replay above does not prove: a guarded
    // `UPDATE … RETURNING` is atomic, so under READ COMMITTED the loser blocks
    // on the row lock, re-evaluates its predicate against the updated row and
    // matches nothing. A read-then-write accept path would pass the test above
    // and fail this one. (`migrateFreshTestDatabase` opens the pool with
    // `max: 2`, so both statements really are in flight.)
    await invitation("invitee-five@machxi.test", "token-hash-five");

    const results = await Promise.all([
      consume("token-hash-five"),
      consume("token-hash-five"),
    ]);

    expect(results.flat()).toHaveLength(1);
  });

  it("refuses a token whose organization has been soft-deleted", async () => {
    const [row] = await invitation("invitee-six@machxi.test", "token-hash-six");

    await client.db
      .update(organizations)
      .set({ deletedAt: new Date() })
      .where(eq(organizations.id, row?.organizationId ?? ""));

    expect(await consume("token-hash-six")).toEqual([]);

    // And the clause is what refused it, rather than the row being spent or
    // stale: the same statement without the `exists` still matches. This is
    // the assertion that fails the day somebody copies the consume out of the
    // record and drops its last line.
    expect(
      (await consume("token-hash-six", { guarded: false })).map(
        (consumed) => consumed.id,
      ),
    ).toEqual([row?.id]);
  });
});

describe("migration 0016 — federated identities", () => {
  /**
   * The two constraints ADR-0072 §1 rests the linking rule on, against real
   * Postgres: the unit suite reads what the schema declares, and this is the
   * only place a constraint that silently failed to apply could be seen.
   */
  const addUser = async (email: string) => {
    const [row] = await client.db
      .insert(users)
      .values(userRow({ email }))
      .returning({ id: users.id });

    return row?.id ?? "";
  };

  it("links a subject to a user and stamps the link", async () => {
    const userId = await addUser("linked@machxi.test");

    const [row] = await client.db
      .insert(federatedIdentities)
      .values({
        userId,
        provider: "google",
        subject: "subject-linked",
        email: "linked@gmail.example",
      })
      .returning();

    expect(row?.linkedAt).toBeInstanceOf(Date);
    expect(row?.lastLoginAt).toBeNull();
  });

  it("refuses a second user for the same provider subject", async () => {
    // One Google account resolves to one user: a second row for the subject
    // would be a way into somebody else's account.
    const userId = await addUser("second-for-subject@machxi.test");

    await expectUniqueViolation(
      client.db
        .insert(federatedIdentities)
        .values({ userId, provider: "google", subject: "subject-linked" }),
    );
  });

  it("refuses a second identity of the same provider for one user", async () => {
    const userId = await addUser("two-googles@machxi.test");

    await client.db
      .insert(federatedIdentities)
      .values({ userId, provider: "google", subject: "subject-first" });

    await expectUniqueViolation(
      client.db
        .insert(federatedIdentities)
        .values({ userId, provider: "google", subject: "subject-second" }),
    );
  });

  it("refuses an identity for a user that does not exist", async () => {
    // The foreign key the credential tables cannot carry and this one does.
    const insert = async () =>
      client.db.insert(federatedIdentities).values({
        userId: "00000000-0000-7000-8000-00000000dead",
        provider: "google",
        subject: "subject-orphan",
      });

    await expect(insert()).rejects.toThrow();

    const error = await insert().catch((caught: unknown) => caught);

    expect((error as { cause?: { code?: string } }).cause?.code).toBe("23503");
  });
});

describe("migration 0017 — the two invariants in the database", () => {
  /**
   * Asserts a check-constraint violation by SQLSTATE and by name.
   *
   * `23514` alone would pass for *any* check on the table, and the name is
   * what a migration that silently failed to apply cannot produce — the same
   * reasoning `expectUniqueViolation` above is written for.
   */
  const expectCheckViolation = async (
    action: Promise<unknown>,
    constraint: string,
  ) => {
    await expect(action).rejects.toThrow();

    const error = await action.catch((caught: unknown) => caught);
    const cause = (
      error as {
        cause?: { code?: string; constraint_name?: string };
      }
    ).cause;

    expect(cause?.code).toBe("23514");
    expect(cause?.constraint_name).toBe(constraint);
  };

  it("refuses an active user with no proven address (ADR-0073 §8)", async () => {
    // `DB-04`: the invariant every downstream rule leans on — invitation
    // acceptance by address, federated linking by `status` alone — used to be
    // held by three code paths remembering. This is the fourth path, the one
    // that forgets, and the database is what stops it.
    await expectCheckViolation(
      client.db.insert(users).values({
        email: "unproven-active@machxi.test",
        status: "active",
        emailVerifiedAt: null,
      }),
      "users_active_email_verified_check",
    );
  });

  it("refuses an existing row being activated without one", async () => {
    // The other half, and the one a repository can reach: `pending_verification`
    // is legal with a null stamp, so the constraint has to fire on the UPDATE
    // that moves such a row to `active` rather than only on an INSERT.
    const email = "activated-unproven@machxi.test";

    await client.db
      .insert(users)
      .values({ email, status: "pending_verification", emailVerifiedAt: null });

    await expectCheckViolation(
      client.db
        .update(users)
        .set({ status: "active" })
        .where(eq(users.email, email)),
      "users_active_email_verified_check",
    );
  });

  it("permits an unproven address on the statuses that are not active", async () => {
    // What the constraint deliberately does not say. `pending_verification` is
    // the row the verification flow exists to move, and `disabled` is a
    // decision about the account rather than a statement about the mailbox.
    await expect(
      client.db.insert(users).values([
        {
          email: "still-pending@machxi.test",
          status: "pending_verification",
          emailVerifiedAt: null,
        },
        {
          email: "disabled-unproven@machxi.test",
          status: "disabled",
          emailVerifiedAt: null,
        },
      ]),
    ).resolves.not.toThrow();
  });

  it("moves updated_at on an update that never names it (ADR-0073 §8)", async () => {
    // `DB-03`: `timestamps()` gained `$onUpdate`, so a repository that forgets
    // the column can no longer ship a stale one. The `set` below names one
    // column and it is not this one.
    const [created] = await client.db
      .insert(users)
      .values(userRow({ email: "touched@machxi.test" }))
      .returning({ id: users.id, updatedAt: users.updatedAt });

    // Postgres timestamps have microsecond resolution and the stamp comes from
    // the driver's clock, so two writes in the same millisecond would be
    // indistinguishable — and a test that could pass on an unchanged value is
    // the one failure mode this assertion exists to rule out.
    await new Promise((resolve) => setTimeout(resolve, 5));

    const [updated] = await client.db
      .update(users)
      .set({ firstName: "Touched" })
      .where(eq(users.id, created?.id ?? ""))
      .returning({ updatedAt: users.updatedAt, createdAt: users.createdAt });

    expect(updated?.updatedAt.getTime()).toBeGreaterThan(
      created?.updatedAt.getTime() ?? 0,
    );
    // `created_at` is not an `$onUpdate` column and must not have moved with it.
    expect(updated?.createdAt.getTime()).toBeLessThan(
      updated?.updatedAt.getTime() ?? 0,
    );
  });

  it("lets a caller that states updated_at keep winning", async () => {
    // The compatibility half: every repository that stamps the column
    // explicitly — several of them stamping a row and one of its neighbours
    // with the *same* instant — is untouched, because Drizzle only fills a
    // column the `set` object does not name.
    const stated = new Date("2030-01-01T00:00:00.000Z");

    const [created] = await client.db
      .insert(users)
      .values(userRow({ email: "stated@machxi.test" }))
      .returning({ id: users.id });

    const [updated] = await client.db
      .update(users)
      .set({ firstName: "Stated", updatedAt: stated })
      .where(eq(users.id, created?.id ?? ""))
      .returning({ updatedAt: users.updatedAt });

    expect(updated?.updatedAt.toISOString()).toBe(stated.toISOString());
  });
});

describe("migration 0018 — the prune's predicates", () => {
  it("the prune predicates are indexed on both sides", async () => {
    // `DB-07` (`D28.4`): each sweep in `prune-sessions.ts` is `expiry < cutoff
    // OR spent < cutoff`, and Postgres serves an `OR` with a BitmapOr only when
    // both columns carry an index. The expiry half of each pair predates this
    // migration; the spent half is `0018`'s, partial on `is not null` because
    // the column is null on every row still live.
    const rows = await rowsOf<{
      tablename: string;
      indexname: string;
      indexdef: string;
    }>(
      sql`select tablename, indexname, indexdef from pg_indexes
          where schemaname = 'public'
            and tablename in ('sessions', 'impersonation_handoffs', 'account_tokens')`,
    );
    const definitionOf = (name: string) =>
      rows.find((row) => row.indexname === name)?.indexdef;

    const pairs = [
      ["sessions_refresh_token_expires_at_idx", "sessions_revoked_at_idx"],
      [
        "impersonation_handoffs_expires_at_idx",
        "impersonation_handoffs_consumed_at_idx",
      ],
      ["account_tokens_expires_at_idx", "account_tokens_consumed_at_idx"],
    ] as const;

    for (const [expiry, spent] of pairs) {
      expect(definitionOf(expiry), expiry).toBeDefined();
      expect(definitionOf(spent), spent).toMatch(
        /\((revoked_at|consumed_at)\) WHERE \(\1 IS NOT NULL\)/i,
      );
    }
  });
});

describe("ping", () => {
  it("resolves against a reachable database (ADR-0003, ADR-0016)", async () => {
    await expect(client.ping()).resolves.toBeUndefined();
  });
});

describe("migration 0019 — row-level security on the tenant-owned tables", () => {
  /**
   * ADR-0067 §5's policies as Postgres holds them (ADR-0078 §4 as amended at
   * `D29.4`). The unit suite proves every listed table *declares* a policy;
   * this proves the migration turned row-level security on and that the
   * application role is bound by it — through a second client on that role
   * that places **no** setting, which is what every connection the API opens
   * is until a transaction scopes it.
   */
  let scoped: DbClient;

  beforeAll(() => {
    scoped = createDb(readTestDatabaseUrl(), { max: 2, idleTimeout: 2 });
  });

  afterAll(async () => {
    await scoped.close();
  });

  const tenant = async (label: string) => {
    const [owner] = await client.db
      .insert(users)
      .values(userRow({ email: `rls-${label}@machxi.test` }))
      .returning({ id: users.id });
    const [organization] = await client.db
      .insert(organizations)
      .values({
        slug: `rls-${label}`,
        name: `RLS ${label}`,
        kind: "team",
        createdBy: owner?.id ?? "",
      })
      .returning({ id: organizations.id });

    await client.db.insert(organizationMemberships).values({
      organizationId: organization?.id ?? "",
      userId: owner?.id ?? "",
      role: "owner",
    });

    return { userId: owner?.id ?? "", organizationId: organization?.id ?? "" };
  };

  it("turns it on for every table in TENANT_OWNED_TABLES", async () => {
    const rows = await rowsOf<{ relname: string; policies: number }>(sql`
      select c.relname, count(p.polname)::int as policies
        from pg_class c
        left join pg_policy p on p.polrelid = c.oid
       where c.relname in (${sql.join(
         TENANT_OWNED_TABLES.map((name) => sql`${name}`),
         sql`, `,
       )})
         and c.relrowsecurity
       group by c.relname
       order by c.relname`);

    expect(rows.map((row) => row.relname)).toEqual(
      [...TENANT_OWNED_TABLES].sort(),
    );
    expect(rows.every((row) => row.policies > 0)).toBe(true);
  });

  it("shows the application role nothing when no setting is placed", async () => {
    const a = await tenant("omitted");

    const [visible] = await scoped.db
      .select({ total: sql<number>`count(*)::int` })
      .from(organizationMemberships);

    expect(visible?.total).toBe(0);

    // And writes nothing: the insert is checked against the same expression.
    const refused = await scoped.db
      .insert(organizationMemberships)
      .values({
        organizationId: a.organizationId,
        userId: a.userId,
        role: "member",
      })
      .catch((caught: unknown) => caught);

    expect((refused as { cause?: { code?: string } }).cause?.code).toBe(
      "42501",
    );
  });

  it("shows one organization's rows, and no other's, to a transaction scoped to it", async () => {
    const a = await tenant("alpha");
    const b = await tenant("beta");

    const seen = await scoped.db.transaction(async (tx) => {
      await setTenantScope(tx, { organizationId: a.organizationId });

      return tx
        .select({ organizationId: organizationMemberships.organizationId })
        .from(organizationMemberships);
    });

    expect(seen.map((row) => row.organizationId)).toEqual([a.organizationId]);
    expect(seen.map((row) => row.organizationId)).not.toContain(
      b.organizationId,
    );

    // The setting is transaction-local: the next statement on the same pool
    // is back to seeing nothing.
    const [after] = await scoped.db
      .select({ total: sql<number>`count(*)::int` })
      .from(organizationMemberships);

    expect(after?.total).toBe(0);
  });
});
