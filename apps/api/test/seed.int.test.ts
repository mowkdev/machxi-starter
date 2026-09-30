import { SUPER_ADMIN_ROLE } from "@repo/contracts";
import { staff, staffRoles, users } from "@repo/db";
import { eq } from "drizzle-orm";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestApp, type TestApp } from "./support/app.js";
import { resetAndSeed, seed, superAdmin } from "./support/seed.js";

/**
 * Seed idempotency, checked through the API rather than only through counts
 * (ADR-0008 §Idempotency, ADR-0021).
 *
 * The seeders are the path `pnpm db:setup` takes on a fresh clone, and the
 * property that matters is not just "no duplicate rows" but "the account it
 * created can still log in afterwards" — a seeder that rewrote a password on
 * the second run would satisfy the first and break the second.
 */
describe("seeders", () => {
  let harness: TestApp;

  beforeAll(async () => {
    harness = createTestApp();
    await resetAndSeed({ hasher: harness.hasher });
  });

  afterAll(async () => {
    await harness.close();
  });

  const countStaff = async (email: string) =>
    (
      await harness.db.db
        .select({ id: staff.id })
        .from(staff)
        .where(eq(staff.email, email))
    ).length;

  it("creates exactly one super admin, however often it runs", async () => {
    const { email } = superAdmin();

    expect(await countStaff(email)).toBe(1);

    // Re-seeded, not reset: "running it twice changes nothing" is only a
    // claim worth testing if nothing was truncated in between.
    await seed({ hasher: harness.hasher });
    await seed({ hasher: harness.hasher });

    expect(await countStaff(email)).toBe(1);
  });

  it("grants the super admin role exactly once", async () => {
    const { email } = superAdmin();
    const [row] = await harness.db.db
      .select({ id: staff.id })
      .from(staff)
      .where(eq(staff.email, email));

    const grants = await harness.db.db
      .select({ role: staffRoles.role })
      .from(staffRoles)
      .where(eq(staffRoles.staffId, row?.id ?? ""));

    expect(grants).toEqual([{ role: SUPER_ADMIN_ROLE }]);
  });

  it("leaves the seeded account able to log in after a re-seed", async () => {
    // The real regression this guards: a seeder that upserted the password
    // would reset a live super admin's credentials to whatever was in someone
    // else's `.env` (ADR-0008).
    await seed({ hasher: harness.hasher });

    await supertest(harness.app)
      .post("/api/v1/admin/auth/login")
      .send(superAdmin())
      .expect(200);
  });

  it("creates the dev fixtures once each", async () => {
    const staffRows = await harness.db.db
      .select({ email: staff.email })
      .from(staff);
    const userRows = await harness.db.db
      .select({ email: users.email })
      .from(users);

    // 1 super admin + manager + editor; 3 users covering all three statuses.
    expect(staffRows).toHaveLength(3);
    expect(userRows).toHaveLength(3);
    expect(new Set(staffRows.map((row) => row.email)).size).toBe(3);
  });

  it("hashes fixture passwords with the parameters the API verifies against", async () => {
    // The seeders take the hasher from the caller precisely so these cannot
    // diverge (ADR-0008 §SeedContext); a mismatch would show up as every
    // fixture login failing, which is what this asserts the absence of.
    await supertest(harness.app)
      .post("/api/v1/user/auth/login")
      .send({ email: "customer@machxi.local", password: "DevPassword!123" })
      .expect(200);
  });
});
