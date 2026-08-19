import { inArray, isNull } from "drizzle-orm";

import { userRoles, users } from "../../src/index.js";
import type { Seeder } from "../types.js";
import { DEV_PASSWORD, DEV_USERS } from "./fixtures.js";

/**
 * Customer accounts covering the three `user_status` values (ADR-0017), so the
 * login flow's "active only" rule and the list endpoint's status filter
 * (ADR-0014) both have something to work with.
 */
export const devUsersSeeder: Seeder = {
  name: "102-dev-users",
  run: async ({ db, hasher, log }) => {
    const passwordHash = await hasher.hash(DEV_PASSWORD);

    await db
      .insert(users)
      .values(
        DEV_USERS.map(({ email, firstName, lastName, status }) => ({
          email,
          passwordHash,
          firstName,
          lastName,
          status,
        })),
      )
      // The conflict target is the **partial** index `users_email_active_unique`
      // (ADR-0028), so the predicate is not optional: without it the insert
      // matches no index at all and Postgres refuses the statement with
      // "there is no unique or exclusion constraint matching the ON CONFLICT
      // specification" — which turns "seeding is idempotent" (ADR-0008) into a
      // crash on the second run rather than a no-op.
      .onConflictDoNothing({
        target: users.email,
        where: isNull(users.deletedAt),
      });

    const rows = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(
        inArray(
          users.email,
          DEV_USERS.map((fixture) => fixture.email),
        ),
      );

    if (rows.length > 0) {
      await db
        .insert(userRoles)
        .values(
          rows.map((row) => ({ userId: row.id, role: "customer" as const })),
        )
        .onConflictDoNothing();
    }

    log(
      `${String(rows.length)} user fixture(s) present, password ${DEV_PASSWORD}`,
    );
  },
};
