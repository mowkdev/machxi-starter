import { and, eq, gt, isNull } from "drizzle-orm";

import { randomToken, sha256Base64url } from "@repo/crypto";

import {
  organizationInvitations,
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
 * signs in as, and it carries one **pending invitation** to the second, so the
 * invitee's own surface has something to answer on a fresh clone.
 *
 * That invitation's token is minted per run and stored only as its SHA-256
 * (ADR-0067 §2, amended). A literal digest committed here would be one shared
 * credential across every clone of this repository from the day the mail
 * deliverable makes the token acceptable — the kind of thing a fixture is
 * exactly the wrong place to hide.
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

    const invitee = await db.query.users.findFirst({
      where: and(
        eq(users.email, DEV_TEAM_ORGANIZATION.invitee),
        isNull(users.deletedAt),
      ),
      columns: { id: true },
    });

    /*
     * Idempotent without a conflict target, because there is none to name: an
     * invitation has no natural key — one address may be invited to one
     * organization many times over its life, once each offer has ended. So the
     * seeder asks whether a *pending* one is already there, which is the same
     * question `listPendingFor` asks, and inserts only when it is not.
     */
    const alreadyPending = await db.query.organizationInvitations.findFirst({
      where: and(
        eq(organizationInvitations.organizationId, organization.id),
        eq(organizationInvitations.email, DEV_TEAM_ORGANIZATION.invitee),
        isNull(organizationInvitations.acceptedAt),
        isNull(organizationInvitations.declinedAt),
        isNull(organizationInvitations.revokedAt),
        // The expiry belongs in the predicate, or the fixture quietly stops
        // existing: an expired row carries no stamp, so without this clause a
        // re-seed a month later would find it, skip the insert, and leave
        // `GET /user/invitations` empty for the surface it exists to feed.
        gt(organizationInvitations.expiresAt, new Date()),
      ),
      columns: { id: true },
    });

    if (invitee !== undefined && alreadyPending === undefined) {
      await db.insert(organizationInvitations).values({
        organizationId: organization.id,
        email: DEV_TEAM_ORGANIZATION.invitee,
        role: DEV_TEAM_ORGANIZATION.inviteeRole,
        invitedBy: owner.id,
        // Minted here, never a literal: see this file's header.
        tokenHash: sha256Base64url(randomToken()),
        // Thirty days, so a clone seeded a fortnight ago still has a pending
        // invitation to look at. The API's own default is
        // `ORGANIZATION_INVITATION_TTL`; a fixture picks the ceiling because
        // its job is to be there, not to expire.
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
    }

    log(
      `${DEV_TEAM_ORGANIZATION.slug} present, owned by ${DEV_TEAM_ORGANIZATION.ownerEmail}, ` +
        `one invitation pending for ${DEV_TEAM_ORGANIZATION.invitee}`,
    );
  },
};
