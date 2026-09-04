import { and, eq, inArray, isNull } from "drizzle-orm";

import {
  organizationMemberships,
  organizations,
  type Db,
} from "../src/index.js";

/**
 * The personal organization, for the one caller that is not a service
 * (ADR-0067 §2).
 *
 * Every path that creates a user creates a personal organization in the same
 * transaction — `POST /public/auth/register`, `POST /admin/users` and the
 * seeders. The first two are the organizations service's from `D15.2`; this is
 * the third, and it lives here rather than in the API because a seeder runs
 * with no container, no request and no context to hand a service.
 *
 * The slug is the same derivation the backfill migration
 * (`0012_backfill_personal_organizations.sql`) uses, and for the same three
 * reasons: deterministic, so this is idempotent without a journal;
 * collision-free, so there is no retry loop against the partial unique index;
 * and it leaks nothing, because a slug is a URL segment and a slug derived
 * from an address would put that address in every pasted link.
 */
export const personalOrganizationSlug = (userId: string): string =>
  `personal-${userId}`;

/** What a personal organization needs to know about the account that owns it. */
export interface PersonalOrganizationOwner {
  readonly id: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
}

/**
 * The organization's display name: the account's own name when it has one,
 * its address when it does not (both name columns are nullable, ADR-0017).
 *
 * The same `coalesce` the backfill migration writes in SQL. Two expressions
 * for one rule is a drift risk worth naming: they are kept together on purpose,
 * and the seed integration test asserts the result rather than the expression.
 */
export const personalOrganizationName = (
  owner: PersonalOrganizationOwner,
): string => {
  const full = [owner.firstName, owner.lastName]
    .filter((part): part is string => part !== null && part.trim() !== "")
    .join(" ")
    .trim();

  return full === "" ? owner.email : full;
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
