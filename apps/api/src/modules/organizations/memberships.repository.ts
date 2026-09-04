import type { OrganizationRole } from "@repo/contracts";
import {
  organizationMemberships,
  organizations,
  users,
  type DbExecutor,
} from "@repo/db";
import { and, eq, isNull, ne, sql } from "drizzle-orm";

/**
 * Every query against `organization_memberships` (ADR-0009).
 *
 * The table is **tenant-owned** (ADR-0067 §1), so every function here takes the
 * organization id as its first, required parameter — `findFor(orgId, userId)`
 * and never `findFor(userId)` with a scope somebody may forget. The one
 * exception is {@link createMembershipsRepository.listForUser}, and it is the
 * sanctioned class rather than a leak: a read scoped by the **principal**
 * rather than by a tenant (ADR-0067 §5, amended), named here for what it is.
 *
 * Two of these functions exist for one invariant — "an organization always has
 * at least one owner" — and the pairing is deliberate: `lockOwnerInvariant`
 * before `countOwnersExcept`, because a count under READ COMMITTED cannot see
 * a concurrent sibling. The service never calls one without the other.
 */

/** A membership row, whole. The pair *is* the identity; there is no `id`. */
export interface MembershipRecord {
  readonly organizationId: string;
  readonly userId: string;
  readonly role: OrganizationRole;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * What `requireMembership` needs in one round trip (ADR-0067 §4): the
 * membership's role and the organization's slug, which rides along because the
 * customer app's URLs are slugs (§6) and a service answering a slug-addressed
 * screen should not look it up twice.
 */
export interface ResolvedMembership {
  readonly organizationId: string;
  readonly slug: string;
  readonly role: OrganizationRole;
}

/**
 * The lock class for the owner invariant.
 *
 * `pg_advisory_xact_lock(int4, int4)`: the first argument names the invariant
 * — an arbitrary but fixed number, so this lock can never collide with the
 * staff role invariant's single-argument one — and the second is the
 * organization, so two organizations serialise independently. `hashtext`
 * rather than the id itself because an advisory key is an integer and a uuid
 * is not; a collision between two organizations costs one extra wait and
 * nothing else, which is why a hash is enough here and would not be if the key
 * decided anything.
 */
const OWNER_INVARIANT_LOCK_CLASS = 67;

export const createMembershipsRepository = (db: DbExecutor) =>
  ({
    /**
     * One membership, by the pair.
     *
     * Says nothing about whether the organization is still live — the caller
     * that needs that asks {@link resolveFor} instead.
     */
    findFor: async (
      organizationId: string,
      userId: string,
      tx: DbExecutor = db,
    ): Promise<MembershipRecord | undefined> =>
      tx.query.organizationMemberships.findFirst({
        where: and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.userId, userId),
        ),
      }),

    /**
     * The guard's read: the membership **and** the organization's slug, and
     * only while the organization is live.
     *
     * The join is not a convenience. `organization_id` cascades on a *hard*
     * delete only, so a membership outlives its organization's soft delete
     * (`D15.1`'s note to this step): a guard that read this table alone would
     * resolve a membership inside a deleted tenant and hand every route below
     * it an `ctx.organization` that should not exist. Filtering here rather
     * than at each call site is what makes that unforgettable.
     */
    resolveFor: async (
      organizationId: string,
      userId: string,
      tx: DbExecutor = db,
    ): Promise<ResolvedMembership | undefined> => {
      const [row] = await tx
        .select({
          organizationId: organizationMemberships.organizationId,
          slug: organizations.slug,
          role: organizationMemberships.role,
        })
        .from(organizationMemberships)
        .innerJoin(
          organizations,
          eq(organizations.id, organizationMemberships.organizationId),
        )
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.userId, userId),
            isNull(organizations.deletedAt),
          ),
        )
        .limit(1);

      return row;
    },

    /**
     * The organizations this account belongs to, live ones only.
     *
     * The sanctioned principal-scoped read (ADR-0067 §5, amended): it carries
     * no tenant because the caller is asking which tenants they have, which is
     * the switcher's question. Served by
     * `organization_memberships_user_id_idx`.
     */
    listForUser: async (
      userId: string,
      tx: DbExecutor = db,
    ): Promise<readonly ResolvedMembership[]> =>
      tx
        .select({
          organizationId: organizationMemberships.organizationId,
          slug: organizations.slug,
          role: organizationMemberships.role,
        })
        .from(organizationMemberships)
        .innerJoin(
          organizations,
          eq(organizations.id, organizationMemberships.organizationId),
        )
        .where(
          and(
            eq(organizationMemberships.userId, userId),
            isNull(organizations.deletedAt),
          ),
        ),

    /**
     * Inserts a membership.
     *
     * @returns `false` when the pair already has one — the composite primary
     *   key is the conflict target, so this is idempotent by construction and
     *   the seeders, the backfill and `ensurePersonalOrganization` can all run
     *   twice (ADR-0008).
     */
    create: async (
      organizationId: string,
      userId: string,
      role: OrganizationRole,
      tx: DbExecutor = db,
    ): Promise<boolean> => {
      const inserted = await tx
        .insert(organizationMemberships)
        .values({ organizationId, userId, role })
        .onConflictDoNothing()
        .returning({ userId: organizationMemberships.userId });

      return inserted.length > 0;
    },

    /** @returns `false` when the pair has no membership to update. */
    updateRole: async (
      organizationId: string,
      userId: string,
      role: OrganizationRole,
      at: Date,
      tx: DbExecutor = db,
    ): Promise<boolean> => {
      const updated = await tx
        .update(organizationMemberships)
        .set({ role, updatedAt: at })
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.userId, userId),
          ),
        )
        .returning({ userId: organizationMemberships.userId });

      return updated.length > 0;
    },

    /**
     * Deletes a membership outright — the one row in this schema that is
     * *hard*-deleted, because a membership is a relation rather than a record
     * with a history: "was a member and is not any more" is expressed by the
     * row's absence, and re-joining is the same pair again.
     *
     * @returns `false` when the pair has no membership, which is what sees a
     *   concurrent removal: a caller that read the row outside this
     *   transaction would otherwise report success for a request that changed
     *   nothing.
     */
    remove: async (
      organizationId: string,
      userId: string,
      tx: DbExecutor = db,
    ): Promise<boolean> => {
      const deleted = await tx
        .delete(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.userId, userId),
          ),
        )
        .returning({ userId: organizationMemberships.userId });

      return deleted.length > 0;
    },

    /**
     * How many owners this organization would still have if `exceptUserId`
     * stopped being one — counting only owners somebody can actually sign in
     * as.
     *
     * Always called behind {@link lockOwnerInvariant} and inside the same
     * transaction as the write it informs, for the reason the staff service
     * gives for its twin: a decision made against a snapshot the write does
     * not land on is a decision two concurrent requests can both take.
     *
     * The join to `users` is the half a count of this table alone would lose.
     * A closed account keeps its **team** memberships — only its personal
     * organization goes with it (ADR-0067 §2), and `user_id` cascades on a
     * *hard* delete only — so a soft-deleted account still holds an `owner`
     * row. Counting it would let the last live owner leave an organization
     * whose only remaining owner cannot sign in: no way to grant ownership,
     * no way to delete it, nobody to ask. "At least one owner" has to mean at
     * least one owner who exists.
     */
    countOwnersExcept: async (
      organizationId: string,
      exceptUserId: string,
      tx: DbExecutor = db,
    ): Promise<number> => {
      const [counted] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(organizationMemberships)
        .innerJoin(users, eq(users.id, organizationMemberships.userId))
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.role, "owner"),
            ne(organizationMemberships.userId, exceptUserId),
            isNull(users.deletedAt),
          ),
        );

      return counted?.total ?? 0;
    },

    /**
     * Serialises the edits that have to reason about *other* memberships of
     * the same organization (ADR-0067 §2, the `lockRoleInvariant` shape of
     * ADR-0017).
     *
     * "An organization always has at least one owner" is checked by counting
     * the owners that are not being edited, and a count sees no uncommitted
     * sibling. Under READ COMMITTED two requests demoting two *different*
     * owners each count the other as the survivor, both pass, both commit, and
     * the organization is left with none — and no member able to grant one.
     * Row locks cannot fix it: the two transactions touch different rows and
     * never conflict, so what is serialised is the *decision*.
     *
     * Scoped to the organization rather than to the table, unlike the staff
     * invariant it is modelled on: there is one staff population and there are
     * many tenants, so a whole-table gate here would make every organization's
     * membership edits queue behind every other's.
     */
    lockOwnerInvariant: async (
      organizationId: string,
      tx: DbExecutor,
    ): Promise<void> => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${OWNER_INVARIANT_LOCK_CLASS}, hashtext(${organizationId}))`,
      );
    },
  }) as const;

export type MembershipsRepository = ReturnType<
  typeof createMembershipsRepository
>;
