import type { ListQuery, OrganizationRole } from "@repo/contracts";
import {
  organizationMemberships,
  organizations,
  setTenantScope,
  users,
  type DbExecutor,
} from "@repo/db";
import { and, asc, count, eq, isNull, ne, sql } from "drizzle-orm";

import {
  withinTransaction,
  type RunInTransaction,
} from "../../core/db/index.js";
import {
  applyListQuery,
  type ColumnMap,
  type ListResult,
} from "../../core/http/index.js";
import type { OrganizationRecord } from "./organizations.repository.js";

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

/** An organization the caller belongs to, with the role that got them there. */
export interface MyOrganizationRecord {
  readonly organization: OrganizationRecord;
  readonly role: OrganizationRole;
}

/** The account behind a membership — its id and address, and nothing else. */
export interface AccountRef {
  readonly id: string;
  readonly email: string;
}

/** A membership joined to the account that holds it — what a members list is. */
export interface MemberRecord {
  readonly organizationId: string;
  readonly userId: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly role: OrganizationRole;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * What a members list may sort and filter by (ADR-0060 §3).
 *
 * Both are columns of `organization_memberships`, never of the joined `users`:
 * an order by a joined column would need an index spanning two tables, which
 * Postgres has no such thing as, and the members list is one organization's
 * rows rather than a page of the account base.
 */
export const listColumns: ColumnMap = {
  createdAt: organizationMemberships.createdAt,
  role: organizationMemberships.role,
};

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

export const createMembershipsRepository = (
  db: DbExecutor,
  transaction: RunInTransaction,
) => {
  const within = withinTransaction(transaction);

  return {
    /**
     * One membership, by the pair.
     *
     * Says nothing about whether the organization is still live — the caller
     * that needs that asks {@link resolveFor} instead.
     */
    findFor: async (
      organizationId: string,
      userId: string,
      caller?: DbExecutor,
    ): Promise<MembershipRecord | undefined> =>
      within(caller, (tx) =>
        tx.query.organizationMemberships.findFirst({
          where: and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.userId, userId),
          ),
        }),
      ),

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
      caller?: DbExecutor,
    ): Promise<ResolvedMembership | undefined> =>
      within(caller, async (tx) => {
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
      }),

    /**
     * The organizations this account belongs to, live ones only — whole rows,
     * because this is what `GET /api/v1/user/orgs` renders.
     *
     * The sanctioned principal-scoped read (ADR-0067 §5, amended): it carries
     * no tenant because the caller is asking which tenants they have, which is
     * the switcher's question. Served by
     * `organization_memberships_user_id_idx`.
     *
     * Unpaged, and ordered here rather than by a query string (ADR-0060's
     * altitude): a person belongs to a handful of organizations, the personal
     * one always among them, and a switcher wants that one first and the rest
     * by name. That is a property of the endpoint, not a client's choice.
     */
    listForUser: async (
      userId: string,
      caller?: DbExecutor,
    ): Promise<readonly MyOrganizationRecord[]> =>
      within(caller, async (tx) => {
        const rows = await tx
          .select({
            id: organizations.id,
            slug: organizations.slug,
            name: organizations.name,
            kind: organizations.kind,
            createdBy: organizations.createdBy,
            createdAt: organizations.createdAt,
            updatedAt: organizations.updatedAt,
            deletedAt: organizations.deletedAt,
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
          )
          .orderBy(
            // `personal` before `team`, which is what these two labels do
            // alphabetically — stated as the order wanted rather than left to be
            // noticed, since a third kind would break the coincidence.
            asc(organizations.kind),
            asc(organizations.name),
            asc(organizations.id),
          );

        return rows.map(({ role, ...organization }) => ({
          organization,
          role,
        }));
      }),

    /**
     * One member of one organization, addressed by their **email**.
     *
     * The one thing an invitation may ask about an address: whether it is
     * already inside *this* organization (ADR-0067 §2). It is the flow's one
     * distinguishable refusal and it is safe for the record's own reason — it
     * tells the inviter only what the members list they can already read would
     * tell them. It answers nothing about accounts outside the organization,
     * which is what keeps the create path enumeration-safe.
     *
     * **Live accounts only**, the same filter `countOwnersExcept` carries and
     * for a sharper reason. A member who closes their account keeps their team
     * memberships — only the personal organization goes with them — while
     * `users_email_active_unique` releases the address, so the same person can
     * register it again. Without this filter the dead membership row would
     * match forever: the returning account could never be invited back, and
     * the owner would be told "already a member" about somebody who is not.
     */
    findByEmail: async (
      organizationId: string,
      email: string,
      caller?: DbExecutor,
    ): Promise<MembershipRecord | undefined> =>
      within(caller, async (tx) => {
        const [row] = await tx
          .select({
            organizationId: organizationMemberships.organizationId,
            userId: organizationMemberships.userId,
            role: organizationMemberships.role,
            createdAt: organizationMemberships.createdAt,
            updatedAt: organizationMemberships.updatedAt,
          })
          .from(organizationMemberships)
          .innerJoin(users, eq(users.id, organizationMemberships.userId))
          .where(
            and(
              eq(organizationMemberships.organizationId, organizationId),
              eq(users.email, email),
              isNull(users.deletedAt),
            ),
          )
          .limit(1);

        return row;
      }),

    /**
     * A live account, by id — its address and nothing else.
     *
     * It reads `users`, another module's table, and it is here rather than
     * behind the users *service* because the alternative is a dependency
     * cycle: the users service already calls this module for the personal
     * organization on every path that creates or deletes an account
     * (ADR-0067 §2), and a service edge back would close the loop. This
     * repository already joins `users` for the members list and for the owner
     * count — the same table at the same layer, which is where ADR-0009 draws
     * the line it draws.
     *
     * Two callers, both needing exactly this. The invitee's own list needs the
     * caller's **address**, which no principal carries (ADR-0018 puts an id
     * and roles in the token and no more); and the admin paths that name an
     * account by id — creating an organization for one, adding one as a
     * member — need to know it is there, because the alternative is a foreign
     * key violation surfacing as a `500`.
     */
    findAccount: async (
      userId: string,
      tx: DbExecutor = db,
    ): Promise<AccountRef | undefined> => {
      const [row] = await tx
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .limit(1);

      return row;
    },

    /**
     * `GET /api/v1/user/orgs/:orgId/members` and its admin twin (ADR-0014 as
     * carried by ADR-0060).
     *
     * Tenant-scoped, so `organizationId` is the required first parameter and
     * it is `and`-ed into the plan rather than left to a caller's filter —
     * the scope is not something a query string can widen.
     *
     * The pagination tiebreaker is `user_id`, there being no `id` column on
     * this table, and the indexes are `(organization_id, column, user_id)` to
     * match. The **default** sort does not read them: `-createdAt` with an
     * ascending tiebreaker is a mixed-direction order no single btree scan
     * serves, so Postgres sorts. That is the repository-wide convention rather
     * than this table's problem — `users`, `staff` and `organizations` all
     * pair a descending default with an ascending tiebreaker — and it is
     * stated here rather than left to be discovered, because a members list is
     * one organization's rows and the sort is therefore cheap.
     */
    list: async (
      organizationId: string,
      query: ListQuery,
      caller?: DbExecutor,
    ): Promise<ListResult<MemberRecord>> =>
      within(caller, async (tx) => {
        const plan = applyListQuery(query, {
          columns: listColumns,
          tiebreaker: organizationMemberships.userId,
          extraWhere: [
            eq(organizationMemberships.organizationId, organizationId),
          ],
        });

        const rows = await tx
          .select({
            organizationId: organizationMemberships.organizationId,
            userId: organizationMemberships.userId,
            email: users.email,
            firstName: users.firstName,
            lastName: users.lastName,
            role: organizationMemberships.role,
            createdAt: organizationMemberships.createdAt,
            updatedAt: organizationMemberships.updatedAt,
          })
          .from(organizationMemberships)
          .innerJoin(users, eq(users.id, organizationMemberships.userId))
          .where(plan.where)
          .orderBy(...plan.orderBy)
          .limit(plan.limit)
          .offset(plan.offset);

        // A closed account's membership is still a membership and is listed as
        // one — the members list is what an owner reads to decide who to remove,
        // and hiding a row nobody can act on would be the worse answer. The
        // invariant count is where a closed account is *not* an owner.
        if (!query.count) return { rows, total: null };

        const [counted] = await tx
          .select({ total: count() })
          .from(organizationMemberships)
          .innerJoin(users, eq(users.id, organizationMemberships.userId))
          .where(plan.where);

        return { rows, total: counted?.total ?? 0 };
      }),

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
      caller?: DbExecutor,
    ): Promise<boolean> =>
      within(caller, async (tx) => {
        const inserted = await tx
          .insert(organizationMemberships)
          .values({ organizationId, userId, role })
          .onConflictDoNothing()
          .returning({ userId: organizationMemberships.userId });

        return inserted.length > 0;
      }),

    /** @returns `false` when the pair has no membership to update. */
    updateRole: async (
      organizationId: string,
      userId: string,
      role: OrganizationRole,
      at: Date,
      caller?: DbExecutor,
    ): Promise<boolean> =>
      within(caller, async (tx) => {
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
      }),

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
      caller?: DbExecutor,
    ): Promise<boolean> =>
      within(caller, async (tx) => {
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
      }),

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
      caller?: DbExecutor,
    ): Promise<number> =>
      within(caller, async (tx) => {
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
      }),

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
    /**
     * Places `organizationId` as the transaction's tenant (ADR-0078 §4 as
     * amended at `D29.4`) — for the one path that acts in an organization no
     * guard resolved: one this transaction has just created (a personal
     * organization on a public route with no principal, a team on the user
     * segment), or the one a just-spent invitation names. The principal's own
     * policy reads their memberships and writes none, so a membership is
     * always written inside its organization's scope.
     */
    enterOrganization: async (
      organizationId: string,
      tx: DbExecutor,
    ): Promise<void> => {
      await setTenantScope(tx, { organizationId });
    },

    lockOwnerInvariant: async (
      organizationId: string,
      tx: DbExecutor,
    ): Promise<void> => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${OWNER_INVARIANT_LOCK_CLASS}, hashtext(${organizationId}))`,
      );
    },
  } as const;
};

export type MembershipsRepository = ReturnType<
  typeof createMembershipsRepository
>;
