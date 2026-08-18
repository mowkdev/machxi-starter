import { eq } from "drizzle-orm";

import { SUPER_ADMIN_ROLE } from "@repo/contracts";

import { staff, staffRoles } from "../../src/index.js";
import type { Seeder } from "../types.js";

/**
 * The one account every environment needs: a staff member holding
 * `super_admin`, which bypasses every staff role check (ADR-0019) and
 * satisfies the "at least one super admin must exist" invariant (ADR-0017).
 *
 * Credentials come from `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD`
 * (ADR-0004). If either is missing the seeder logs and skips — there is
 * deliberately no hard-coded fallback, because a default super-admin password
 * in a public blueprint is a credential every deployment would inherit.
 */
export const superAdminSeeder: Seeder = {
  name: "001-super-admin",
  run: async ({ db, hasher, log, env }) => {
    const { superAdminEmail, superAdminPassword } = env;

    if (superAdminEmail === undefined || superAdminPassword === undefined) {
      log(
        "skipped — set SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD to create one",
      );

      return;
    }

    // Hashing before the insert costs ~130 ms even when the row already
    // exists. Accepted: checking first and hashing only on a miss would race
    // two concurrent seeds into two inserts, and this runs once per deploy.
    const passwordHash = await hasher.hash(superAdminPassword);

    const [created] = await db
      .insert(staff)
      .values({
        email: superAdminEmail,
        passwordHash,
        firstName: "Super",
        lastName: "Admin",
        status: "active",
      })
      // `email` is citext-unique, so this is the idempotency point: a second
      // run inserts nothing. It deliberately does **not** upsert the password
      // — a seeder that rewrote credentials could reset a live super admin's
      // password to a stale value from someone's `.env`, and "the seed is safe
      // to re-run" must stay true in production.
      .onConflictDoNothing({ target: staff.email })
      .returning({ id: staff.id });

    const existing =
      created ??
      (await db.query.staff.findFirst({
        columns: { id: true },
        where: eq(staff.email, superAdminEmail),
      }));

    if (existing === undefined) {
      throw new Error(
        "001-super-admin: the account was neither inserted nor found; the unique index on staff.email may be missing.",
      );
    }

    // Granted separately and idempotently: an account that exists but lost its
    // role is exactly the state this seeder is meant to repair.
    await db
      .insert(staffRoles)
      .values({ staffId: existing.id, role: SUPER_ADMIN_ROLE })
      .onConflictDoNothing();

    log(
      created === undefined
        ? `already present — left unchanged (password not rewritten)`
        : `created ${superAdminEmail}`,
    );
  },
};
