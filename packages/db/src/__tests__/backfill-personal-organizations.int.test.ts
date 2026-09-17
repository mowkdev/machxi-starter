import { readFileSync } from "node:fs";
import { join } from "node:path";

import { and, count, eq, isNull, sql as raw } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "../client.js";
import { organizationMemberships, organizations, users } from "../index.js";
import { migrationsFolder } from "../tooling/env.js";
import { migrateFreshTestDatabase } from "./helpers.int.js";

/**
 * The backfill migration, against real Postgres (ADR-0067 §2).
 *
 * `0012_backfill_personal_organizations.sql` is what makes the record's
 * central claim — **no query anywhere has a "no organization" branch** — true
 * on the day the tables land rather than only for accounts created after it.
 * The claim is worth exactly as much as this file: it is a hand-written
 * migration, so no generator checked it, and its idempotency has no journal
 * behind it because a database somebody restored by hand can be replayed
 * against.
 *
 * The SQL is **read from the committed file** rather than restated here. A
 * copy would pass while the file it stands for was broken, which is the whole
 * failure mode of testing a migration.
 */

/** The committed statements, in order, as the runner splits them. */
const backfillStatements = (): string[] =>
  readFileSync(
    join(migrationsFolder, "0012_backfill_personal_organizations.sql"),
    "utf8",
  )
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "");

let client: DbClient;

const runBackfill = async (): Promise<void> => {
  for (const statement of backfillStatements()) {
    await client.db.execute(raw.raw(statement));
  }
};

const countOf = async (
  table: typeof organizations | typeof organizationMemberships | typeof users,
): Promise<number> => {
  const [row] = await client.db.select({ value: count() }).from(table);

  return row?.value ?? 0;
};

beforeAll(async () => {
  client = await migrateFreshTestDatabase();
}, 60_000);

afterAll(async () => {
  await client.close();
});

/**
 * The stamp `users_active_email_verified_check` asks of every `active` row
 * (ADR-0073 §8, migration `0017`). Fixture furniture here — this file is about
 * the backfill of `0012`, and the backfill reads `deleted_at` and the two name
 * columns and nothing else — but a fixture that could not be inserted would
 * make the whole file vacuous, so it is spelled rather than defaulted.
 */
const VERIFIED_AT = new Date();

describe("0012_backfill_personal_organizations", () => {
  it("is more than one statement, so the split below is not a no-op", () => {
    // The guard: a mis-split would run nothing and every assertion under it
    // would pass against an empty database.
    expect(backfillStatements().length).toBe(2);
  });

  it("creates exactly one personal organization for a user that has none", async () => {
    // The state a real deployment is in the moment `0011` lands: rows that
    // predate the tables. The migration ran during `migrateFreshTestDatabase`
    // against no users at all, so this account is inserted after it.
    const [user] = await client.db
      .insert(users)
      .values({
        email: "backfill@machxi.test",
        firstName: "Bea",
        lastName: "Backfill",
        emailVerifiedAt: VERIFIED_AT,
      })
      .returning({ id: users.id });

    expect(user).toBeDefined();

    await runBackfill();

    const owned = await client.db
      .select({
        id: organizations.id,
        kind: organizations.kind,
        name: organizations.name,
        slug: organizations.slug,
      })
      .from(organizations)
      .where(eq(organizations.createdBy, user?.id ?? ""));

    expect(owned).toHaveLength(1);
    expect(owned[0]?.kind).toBe("personal");
    // The account's own name, not its address (ADR-0017 makes both name
    // columns nullable, so the migration coalesces).
    expect(owned[0]?.name).toBe("Bea Backfill");
    // Derived from the id and never from the address: a slug is a URL segment,
    // and a pasted link must not carry an email address.
    expect(owned[0]?.slug).toBe(`personal-${user?.id ?? ""}`);
  });

  it("makes the account the owner of it (ADR-0067 §2)", async () => {
    const memberships = await client.db
      .select({
        role: organizationMemberships.role,
        userId: organizationMemberships.userId,
      })
      .from(organizationMemberships);

    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.role).toBe("owner");
  });

  it("falls back to the address when the account has no name", async () => {
    await client.db
      .insert(users)
      .values({ email: "nameless@machxi.test", emailVerifiedAt: VERIFIED_AT });

    await runBackfill();

    const organization = await client.db.query.organizations.findFirst({
      where: eq(organizations.name, "nameless@machxi.test"),
    });

    expect(organization?.kind).toBe("personal");
  });

  it("adds nothing on a second run", async () => {
    const before = [
      await countOf(organizations),
      await countOf(organizationMemberships),
    ];

    await runBackfill();
    await runBackfill();

    expect([
      await countOf(organizations),
      await countOf(organizationMemberships),
    ]).toEqual(before);
  });

  it("leaves a soft-deleted account without one", async () => {
    // A deleted account has no organization for the same reason it has no
    // session: the deletion transaction of ADR-0028 is what would have
    // soft-deleted the organization beside it.
    const [deleted] = await client.db
      .insert(users)
      .values({
        email: "gone@machxi.test",
        deletedAt: new Date(),
        emailVerifiedAt: VERIFIED_AT,
      })
      .returning({ id: users.id });

    await runBackfill();

    const owned = await client.db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.createdBy, deleted?.id ?? ""));

    expect(owned).toEqual([]);
  });

  it("repairs a live account whose personal organization was soft-deleted", async () => {
    // The two statements have to agree about what "has a personal
    // organization" means, and the disagreement would resolve the unsafe way:
    // a live account whose organization carries `deleted_at` would be skipped
    // forever and become the "no organization" branch the record says cannot
    // exist. The partial unique index is what makes the repair possible — a
    // soft-deleted row does not reserve its slug.
    const [user] = await client.db
      .insert(users)
      .values({ email: "orphaned@machxi.test", emailVerifiedAt: VERIFIED_AT })
      .returning({ id: users.id });

    await runBackfill();
    await client.db
      .update(organizations)
      .set({ deletedAt: new Date() })
      .where(eq(organizations.createdBy, user?.id ?? ""));

    await runBackfill();

    const live = await client.db
      .select({ id: organizations.id })
      .from(organizations)
      .where(
        and(
          eq(organizations.createdBy, user?.id ?? ""),
          isNull(organizations.deletedAt),
        ),
      );

    expect(live).toHaveLength(1);
  });

  it("does not put an owner membership back on a soft-deleted organization", async () => {
    // ADR-0028's deletion transaction soft-deletes the personal organization
    // beside the account (ADR-0067 §2). A replay must not undo half of that.
    const [user] = await client.db
      .insert(users)
      .values({
        email: "deleted-both@machxi.test",
        emailVerifiedAt: VERIFIED_AT,
      })
      .returning({ id: users.id });

    await runBackfill();

    const [organization] = await client.db
      .update(organizations)
      .set({ deletedAt: new Date() })
      .where(eq(organizations.createdBy, user?.id ?? ""))
      .returning({ id: organizations.id });

    await client.db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, user?.id ?? ""));
    await client.db
      .delete(organizationMemberships)
      .where(
        eq(organizationMemberships.organizationId, organization?.id ?? ""),
      );

    await runBackfill();

    const memberships = await client.db
      .select({ userId: organizationMemberships.userId })
      .from(organizationMemberships)
      .where(
        eq(organizationMemberships.organizationId, organization?.id ?? ""),
      );

    expect(memberships).toEqual([]);
  });

  it("repairs a live organization whose owner membership went missing", async () => {
    // Not reachable through the migration runner, whose batch is one
    // transaction — reachable by hand, which is why the second statement
    // carries its own guard rather than being folded into the first.
    await client.db.delete(organizationMemberships);

    await runBackfill();

    // Live on both sides, which is what the second statement restores: the
    // soft-deleted rows the two tests above left behind stay memberless.
    const repairable = await client.db
      .select({ id: organizations.id })
      .from(organizations)
      .innerJoin(users, eq(users.id, organizations.createdBy))
      .where(and(isNull(organizations.deletedAt), isNull(users.deletedAt)));

    expect(await countOf(organizationMemberships)).toBe(repairable.length);
  });
});
