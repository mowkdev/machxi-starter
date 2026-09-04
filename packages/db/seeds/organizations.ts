import { and, eq, inArray, isNull } from "drizzle-orm";

import {
  organizationMemberships,
  organizations,
  personalOrganizationName,
  personalOrganizationSlug,
  type Db,
  type PersonalOrganizationOwner,
} from "../src/index.js";

export {
  personalOrganizationName,
  personalOrganizationSlug,
  type PersonalOrganizationOwner,
};

/**
 * Creates the missing personal organizations and their `owner` memberships,
 * and returns how many organizations existed afterwards.
 *
 * Idempotent by construction (ADR-0008): the insert names the **partial**
 * unique index as its conflict target — the `users_email_active_unique`
 * reading — so a second run conflicts and does nothing rather than raising,
 * and the membership insert conflicts on the composite primary key.
 */
export const ensurePersonalOrganizations = async (
  db: Db,
  owners: readonly PersonalOrganizationOwner[],
): Promise<number> => {
  if (owners.length === 0) return 0;

  await db
    .insert(organizations)
    .values(
      owners.map((owner) => ({
        slug: personalOrganizationSlug(owner.id),
        name: personalOrganizationName(owner),
        kind: "personal" as const,
        createdBy: owner.id,
      })),
    )
    // The conflict target is `organizations_slug_active_unique`, which is
    // partial: without the predicate the insert matches no index at all and
    // Postgres refuses the statement outright (ADR-0028's reading, and the
    // reason `102-dev-users` names the same predicate).
    .onConflictDoNothing({
      target: organizations.slug,
      where: isNull(organizations.deletedAt),
    });

  const rows = await db
    .select({ id: organizations.id, createdBy: organizations.createdBy })
    .from(organizations)
    .where(
      and(
        eq(organizations.kind, "personal"),
        isNull(organizations.deletedAt),
        inArray(
          organizations.createdBy,
          owners.map((owner) => owner.id),
        ),
      ),
    );

  if (rows.length > 0) {
    await db
      .insert(organizationMemberships)
      .values(
        rows.map((row) => ({
          organizationId: row.id,
          userId: row.createdBy,
          role: "owner" as const,
        })),
      )
      .onConflictDoNothing();
  }

  return rows.length;
};
