import { and, eq, isNull } from "drizzle-orm";

import {
  organizationMemberships,
  organizations,
  users,
} from "../../src/index.js";
import type { Seeder } from "../types.js";
import { DEV_TEAM_ORGANIZATION } from "./fixtures.js";

/**
 * One `team` organization, so the tenant paths have something to run against
 * that is not a personal organization (ADR-0067 §2).
 *
 * The personal ones are created beside their accounts by `102-dev-users`;
 * this seeder exists because a `team` organization is the only shape that
 * exercises the parts of the model a personal one cannot: a second member, an
 * invitation, a role that is not `owner`, and a `DELETE` that is allowed. The
 * Postman collection (ADR-0021) needs a known slug to address, which is what
 * makes this a fixture rather than something a test creates for itself.
 *
 * Its owner is the first `--dev` customer, who is also the account Postman
 * signs in as.
 */
export const devOrganizationsSeeder: Seeder = {
  name: "103-dev-organizations",
  run: async ({ db, log }) => {
    const owner = await db.query.users.findFirst({
      where: and(
        eq(users.email, DEV_TEAM_ORGANIZATION.ownerEmail),
        isNull(users.deletedAt),
      ),
      columns: { id: true },
    });

    if (owner === undefined) {
      // `102-dev-users` runs first and creates it. Skipping rather than
      // throwing keeps `--dev` re-runnable against a database somebody has
      // been deleting rows in by hand.
      log(
        `owner ${DEV_TEAM_ORGANIZATION.ownerEmail} is absent; skipping the team organization`,
      );
      return;
    }

    await db
      .insert(organizations)
      .values({
        slug: DEV_TEAM_ORGANIZATION.slug,
        name: DEV_TEAM_ORGANIZATION.name,
        kind: "team",
        createdBy: owner.id,
      })
      // The partial unique index, named with its predicate for the reason
      // `102-dev-users` gives: without it the insert matches no index and
      // Postgres refuses the statement (ADR-0028).
      .onConflictDoNothing({
        target: organizations.slug,
        where: isNull(organizations.deletedAt),
      });

    const organization = await db.query.organizations.findFirst({
      where: and(
        eq(organizations.slug, DEV_TEAM_ORGANIZATION.slug),
        isNull(organizations.deletedAt),
      ),
      columns: { id: true },
    });

    if (organization === undefined) {
      log(`${DEV_TEAM_ORGANIZATION.slug} could not be read back; skipping`);
      return;
    }

    // An organization always has at least one owner (ADR-0067 §2), and a
    // fixture is not exempt from the invariant it exists to exercise.
    await db
      .insert(organizationMemberships)
      .values({
        organizationId: organization.id,
        userId: owner.id,
        role: "owner",
      })
      .onConflictDoNothing();

    log(
      `${DEV_TEAM_ORGANIZATION.slug} present, owned by ${DEV_TEAM_ORGANIZATION.ownerEmail}`,
    );
  },
};
