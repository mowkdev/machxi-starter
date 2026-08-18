import { inArray } from "drizzle-orm";

import { staff, staffRoles } from "../../src/index.js";
import type { Seeder } from "../types.js";
import { DEV_PASSWORD, DEV_STAFF } from "./fixtures.js";

/**
 * A manager and an editor, so the staff role guards (ADR-0019) can be checked
 * against somebody the `super_admin` bypass does not cover.
 */
export const devStaffSeeder: Seeder = {
  name: "101-dev-staff",
  run: async ({ db, hasher, log }) => {
    const passwordHash = await hasher.hash(DEV_PASSWORD);

    await db
      .insert(staff)
      .values(
        DEV_STAFF.map(({ email, firstName, lastName }) => ({
          email,
          passwordHash,
          firstName,
          lastName,
          status: "active" as const,
        })),
      )
      .onConflictDoNothing({ target: staff.email });

    // Re-read rather than trusting `returning()`: on a second run the insert
    // returns nothing, and the grants below still have to be reconciled.
    const rows = await db
      .select({ id: staff.id, email: staff.email })
      .from(staff)
      .where(
        inArray(
          staff.email,
          DEV_STAFF.map((fixture) => fixture.email),
        ),
      );

    // Keyed lower-case: `email` is citext, so a row that already existed as
    // `Manager@machxi.local` matches the fixture and must not be treated as a
    // different account.
    const idByEmail = new Map(
      rows.map((row) => [row.email.toLowerCase(), row.id]),
    );

    const grants = DEV_STAFF.flatMap((fixture) => {
      const staffId = idByEmail.get(fixture.email.toLowerCase());

      return staffId === undefined ? [] : [{ staffId, role: fixture.role }];
    });

    if (grants.length > 0) {
      await db.insert(staffRoles).values(grants).onConflictDoNothing();
    }

    log(
      `${String(rows.length)} staff fixture(s) present, password ${DEV_PASSWORD}`,
    );
  },
};
