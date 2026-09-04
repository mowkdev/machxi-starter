import { and, inArray, isNull } from "drizzle-orm";

import { userRoles, users } from "../../src/index.js";
import { ensurePersonalOrganizations } from "../organizations.js";
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

    // Live rows only. Since the index became partial an address may name two
    // rows — one deleted, one live — and granting `customer` to the dead one
    // is both pointless and an over-count in the line this seeder logs.
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(users)
      .where(
        and(
          isNull(users.deletedAt),
          inArray(
            users.email,
            DEV_USERS.map((fixture) => fixture.email),
          ),
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

    // Every path that creates a user creates their personal organization
    // (ADR-0067 §2). The seeders are one of the three, so the fixtures carry
    // the same invariant the API does rather than being the one population in
    // the database that breaks it.
    const organizations = await ensurePersonalOrganizations(db, rows);

    log(
      `${String(rows.length)} user fixture(s) present with ${String(organizations)} personal organization(s), password ${DEV_PASSWORD}`,
    );
  },
};
