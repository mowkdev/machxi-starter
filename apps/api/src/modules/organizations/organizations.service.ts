import type { OrganizationRole } from "@repo/contracts";
import {
  personalOrganizationName,
  personalOrganizationSlug,
  type DbExecutor,
  type PersonalOrganizationOwner,
} from "@repo/db";

import type { RequestContext } from "../../core/context/index.js";
import { internal } from "../../core/errors/index.js";
import {
  lastOrganizationOwner,
  membershipNotFound,
  organizationNotFound,
  personalOrganizationUndeletable,
} from "./organizations.errors.js";
import type { MembershipsRepository } from "./memberships.repository.js";
import type { OrganizationsRepository } from "./organizations.repository.js";

/**
 * The organizations service (ADR-0009, ADR-0067 §2).
 *
 * It owns three things at `D15.2`: the personal organization's whole
 * lifecycle, which every path that creates or deletes a user goes through; the
 * two invariants that keep an organization's membership coherent; and the
 * reads `requireMembership` resolves a request against. The HTTP surface that
 * calls the rest of it — creating a team organization, editing one, the
 * invitation flow — is `D15.3`'s.
 *
 * Two of its functions are called by *other modules' services* rather than by
 * a controller: `ensurePersonalOrganizationFor` from the auth service's
 * `register` and from the users service's `create`, and
 * `deletePersonalOrganizationFor` from both of the users service's deletion
 * paths. That is the service-to-service edge ADR-0009 permits and the shape
 * the `sessions` dependency already has — a module reaches another module's
 * *service*, narrowed to what it may call, and never its repository. It runs
 * on the caller's transaction, so "a user exists" and "that user has a
 * personal organization" are one commit and there is no window in which the
 * first is true and the second is not.
 */

export interface OrganizationsServiceDeps {
  readonly repository: OrganizationsRepository;
  readonly memberships: MembershipsRepository;
  /** Runs `fn` inside one database transaction (ADR-0006). */
  readonly transaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  readonly now?: () => Date;
}

export const createOrganizationsService = ({
  repository,
  memberships,
  transaction,
  now = () => new Date(),
}: OrganizationsServiceDeps) => {
  /** A live organization, or the refusal every read of a missing one gives. */
  const read = async (id: string, tx?: DbExecutor) => {
    const record = await repository.findById(id, tx);

    if (record === undefined) throw organizationNotFound();

    return record;
  };

  /**
   * The last-owner invariant (ADR-0067 §2), in one place because both writes
   * that can break it break it the same way.
   *
   * It assumes the caller has already taken `lockOwnerInvariant` — see
   * {@link lockedMembershipWrite}, which is the only way in. The lock is not
   * taken here because by the time this function has a role to look at, the
   * read that produced it has already happened: the count is only as good as
   * the snapshot the *whole decision* was made against, and that snapshot
   * starts at the role read, not at the count.
   */
  const assertOwnerSurvives = async (
    organizationId: string,
    losing: { readonly userId: string; readonly role: OrganizationRole },
    tx: DbExecutor,
  ): Promise<void> => {
    if (losing.role !== "owner") return;

    const remaining = await memberships.countOwnersExcept(
      organizationId,
      losing.userId,
      tx,
    );

    if (remaining === 0) throw lastOrganizationOwner();
  };

  /**
   * Every write that can break the owner invariant, inside one transaction
   * with the lock taken **before the first read**.
   *
   * The ordering is the staff service's, and it is the ordering because the
   * alternative loses to a stale role. Taking the lock only once a role read
   * says "owner" leaves the non-owner path unserialised, and a non-owner path
   * can still empty an organization: a removal reads `member`, skips the lock,
   * and by the time it deletes, that member has been promoted to owner and the
   * previous sole owner has been removed by a request that counted this one as
   * the survivor. Two writes, each individually correct against what it read,
   * and no owner left.
   *
   * So the lock is the first statement, and it covers the read as well as the
   * count. It is per organization (`lockOwnerInvariant` says why), so this
   * serialises one tenant's membership edits and no other's, and it is
   * released with the transaction either way.
   */
  const lockedMembershipWrite = async <T>(
    organizationId: string,
    write: (tx: DbExecutor) => Promise<T>,
  ): Promise<T> =>
    transaction(async (tx) => {
      await memberships.lockOwnerInvariant(organizationId, tx);

      return write(tx);
    });

  return {
    /**
     * The personal organization, created or found (ADR-0067 §2).
     *
     * Called by every path that brings a user into existence —
     * `POST /public/auth/register`, `POST /admin/users`, and (through the
     * seeders' own copy of this, which shares the derivation rather than the
     * code, because a seeder has no container) `pnpm db:seed`. It runs on the
     * transaction the caller is already in, which is the whole point: the
     * account and its organization commit together, so "every user has at
     * least one organization" is a property of the database rather than a
     * sequence somebody must not interrupt.
     *
     * **Idempotent**, and by construction rather than by a read-then-write:
     * the slug is derived from the account's id, so a second call conflicts on
     * `organizations_slug_active_unique` and does nothing, and the membership
     * conflicts on its composite primary key. That matters beyond retries —
     * the backfill migration ran the same derivation in SQL, so this is also
     * what makes the migration and the API agree about an account created on
     * either side of it.
     *
     * @returns the organization's id, so a caller that wants to log or return
     *   it need not read the row back.
     */
    ensurePersonalOrganizationFor: async (
      ctx: RequestContext,
      owner: PersonalOrganizationOwner,
      tx: DbExecutor,
    ): Promise<string> => {
      const slug = personalOrganizationSlug(owner.id);

      const created = await repository.create(
        {
          slug,
          name: personalOrganizationName(owner),
          kind: "personal",
          createdBy: owner.id,
        },
        tx,
      );

      // `undefined` means a live organization already holds the slug, and the
      // slug is derived from this account's id — so the row is this account's
      // own personal organization and this call is a repeat. Read it back
      // rather than assuming: the membership insert below needs its id, and a
      // slug collision that was *not* this account's would be a squatted
      // reserved prefix, which `slugSchema` refuses at the edge.
      const organization =
        created ?? (await repository.findPersonalFor(owner.id, tx));

      if (organization === undefined) {
        // Not reachable through any request: the insert either created the row
        // or conflicted with this account's own, and `personal-` is reserved
        // so no other account can hold the slug. A 500 rather than a guess,
        // because the alternative is a user with no organization — the one
        // state ADR-0067 §2 exists to make impossible.
        throw internal(
          new Error(
            `personal organization for ${owner.id} neither created nor found`,
          ),
        );
      }

      await memberships.create(organization.id, owner.id, "owner", tx);

      ctx.logger.debug(
        { userId: owner.id, organizationId: organization.id },
        "personal organization ensured",
      );

      return organization.id;
    },

    /**
     * Soft-deletes the account's personal organization, inside the
     * transaction that is deleting the account (ADR-0067 §2, ADR-0028).
     *
     * The only path by which a personal organization is deleted at all: on its
     * own it refuses with `409`, because a user with no organization is a
     * state no query in this repository has a branch for. Both user-deletion
     * paths call it — `DELETE /admin/users/:id` and `DELETE /user/profile` —
     * and both pass their own `at`, so the account and its organization carry
     * the same `deleted_at`.
     *
     * Silent when there is nothing to delete: an account whose organization
     * was already soft-deleted, or one created before the backfill and somehow
     * missed by it, must still be deletable. A deletion that refused because
     * of a missing dependent row would be an account nobody can close.
     *
     * The team organizations the account owns are deliberately **untouched**.
     * Deleting a user does not delete the teams they created — other people
     * are in them — and what happens to a team whose last owner closes their
     * account is a question ADR-0067 does not answer; it becomes real only
     * when the deletion paths meet the ownership invariant, which is beyond
     * this deliverable's scope boundary (§7).
     */
    deletePersonalOrganizationFor: async (
      ctx: RequestContext,
      userId: string,
      at: Date,
      tx: DbExecutor,
    ): Promise<void> => {
      const organization = await repository.findPersonalFor(userId, tx);

      if (organization === undefined) return;

      await repository.softDelete(organization.id, at, tx);

      ctx.logger.info(
        { userId, organizationId: organization.id },
        "personal organization deleted with its account",
      );
    },

    /**
     * Soft-deletes a `team` organization (ADR-0067 §3).
     *
     * A `personal` one refuses with `409` rather than `403`: the caller is its
     * owner and holds exactly the role the route requires, and what the
     * request conflicts with is the organization's kind.
     *
     * Memberships and invitations are **not** removed. They cascade on a hard
     * delete only, so they survive this — which is why every read of either
     * joins `organizations` and filters `deleted_at`, rather than trusting the
     * absence of a row.
     */
    remove: async (ctx: RequestContext, id: string): Promise<void> => {
      const at = now();
      const record = await read(id);

      if (record.kind === "personal") throw personalOrganizationUndeletable();

      await transaction(async (tx) => {
        // The boolean is what sees a concurrent delete: the read above ran
        // outside this transaction, so two owners deleting at once can both
        // pass it, and the loser would otherwise change nothing and answer
        // `204` for a request that did nothing.
        if (!(await repository.softDelete(record.id, at, tx))) {
          throw organizationNotFound();
        }
      });

      ctx.logger.info(
        { organizationId: record.id, slug: record.slug },
        "organization deleted",
      );
    },

    /**
     * Changes a member's role (ADR-0067 §2).
     *
     * The read, the invariant and the write are one transaction because they
     * are one decision: the count that decides whether the last owner is being
     * demoted must be taken against the snapshot the update lands on.
     */
    setMemberRole: async (
      ctx: RequestContext,
      organizationId: string,
      userId: string,
      role: OrganizationRole,
    ): Promise<void> => {
      const at = now();

      await lockedMembershipWrite(organizationId, async (tx) => {
        const organization = await read(organizationId, tx);
        const membership = await memberships.findFor(
          organization.id,
          userId,
          tx,
        );

        if (membership === undefined) throw membershipNotFound();
        if (membership.role === role) return;

        await assertOwnerSurvives(
          organization.id,
          { userId, role: membership.role },
          tx,
        );

        if (
          !(await memberships.updateRole(organization.id, userId, role, at, tx))
        ) {
          throw membershipNotFound();
        }
      });

      ctx.logger.info(
        { organizationId, userId, role },
        "organization membership role changed",
      );
    },

    /**
     * Removes a member (ADR-0067 §2) — somebody else, or the caller leaving.
     *
     * One function for both, because they are the same write with the same
     * invariant: the last owner cannot be removed and cannot leave, and which
     * of the two it is only changes who was allowed to ask. That difference
     * belongs to the route's guard (`D15.3`), not here.
     */
    removeMember: async (
      ctx: RequestContext,
      organizationId: string,
      userId: string,
    ): Promise<void> => {
      await lockedMembershipWrite(organizationId, async (tx) => {
        const organization = await read(organizationId, tx);
        const membership = await memberships.findFor(
          organization.id,
          userId,
          tx,
        );

        if (membership === undefined) throw membershipNotFound();

        await assertOwnerSurvives(
          organization.id,
          { userId, role: membership.role },
          tx,
        );

        if (!(await memberships.remove(organization.id, userId, tx))) {
          throw membershipNotFound();
        }
      });

      ctx.logger.info(
        { organizationId, userId },
        "organization membership removed",
      );
    },
  } as const;
};

export type OrganizationsService = ReturnType<
  typeof createOrganizationsService
>;
