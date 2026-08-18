import type {
  CreateStaffBody,
  ListStaffQuery,
  Page,
  StaffResource,
  StaffRole,
  UpdateStaffBody,
} from "@repo/contracts";
import { SUPER_ADMIN_ROLE } from "@repo/contracts";
import type { DbExecutor } from "@repo/db";

import type { LimitedHasher } from "../../core/auth/index.js";
import { requirePopulation } from "../../core/auth/index.js";
import type { RequestContext } from "../../core/context/index.js";
import { toPage } from "../../core/http/index.js";
import { REVOKE_REASONS, type AuthService } from "../auth/index.js";
import {
  lastSuperAdmin,
  staffEmailTaken,
  staffNotFound,
  superAdminGrantForbidden,
  superAdminTargetForbidden,
} from "./staff.errors.js";
import { toStaffResource } from "./staff.mapper.js";
import type { StaffRecord, StaffRepository } from "./staff.repository.js";

/**
 * Staff administration — `/api/v1/admin/staff` (ADR-0009).
 *
 * Everything the router mounts behind `authorize("admin")` is here; the guard
 * answers "may this caller manage staff at all?", and this layer answers the
 * questions a guard cannot see, which in v1 is exactly one: the ADR-0017
 * invariant that an active `super_admin` must survive every edit.
 *
 * No Express, no SQL. `ctx` is the first parameter of every function
 * (ADR-0010), and every failure is an `AppError` the error middleware renders.
 */

/**
 * Whether two role sets are the same set, order and duplicates aside.
 *
 * A `PATCH` that re-sends the roles an account already holds is a no-op, and
 * must not cost the account its sessions — the revocation below exists to make
 * a *change* take effect, not to punish a client that sends the whole
 * resource back.
 */
const sameRoles = (
  next: readonly StaffRole[],
  current: readonly StaffRole[],
): boolean => {
  const a = new Set(next);
  const b = new Set(current);

  return a.size === b.size && [...a].every((role) => b.has(role));
};

export interface StaffServiceDeps {
  readonly repository: StaffRepository;
  /** Already wrapped in the process-wide concurrency cap (ADR-0020). */
  readonly hasher: LimitedHasher;
  /**
   * The auth module's session revocation, bound to the `staff` population by
   * the container. Narrowed to the one function this service may call: a
   * module depends on another module's *service*, never its repository
   * (ADR-0009), and it should not be handed login while it is at it.
   */
  readonly sessions: Pick<AuthService, "revokeSessionsFor">;
  /** Runs `fn` inside one database transaction (ADR-0006). */
  readonly transaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  readonly now?: () => Date;
}

export const createStaffService = ({
  repository,
  hasher,
  sessions,
  transaction,
  now = () => new Date(),
}: StaffServiceDeps) => {
  /** The acting staff member — `staff_roles.granted_by`, and the role rules below. */
  const actor = (ctx: RequestContext) => requirePopulation(ctx, "staff");

  const isSuperAdmin = (ctx: RequestContext): boolean =>
    actor(ctx).roles.includes(SUPER_ADMIN_ROLE);

  /**
   * Refuses a change to `super_admin` membership made by somebody who is not
   * one (ADR-0017 §Invariants).
   *
   * `authorize("admin")` is what lets a caller reach these endpoints at all,
   * so without this an `admin` could `PATCH` their own id with
   * `roles: ["super_admin"]` and promote themselves. The role that bypasses
   * every other role check must not be reachable from below it.
   *
   * Only a *change* is refused: an admin editing a super admin's name, or
   * re-sending a role set that already contains it, is not an escalation and
   * the last-super-admin invariant is what guards the removal side.
   */
  const assertMaySetSuperAdmin = (
    ctx: RequestContext,
    nextRoles: readonly StaffRole[] | undefined,
    currentRoles: readonly StaffRole[],
  ): void => {
    if (nextRoles === undefined) return;

    const changes =
      nextRoles.includes(SUPER_ADMIN_ROLE) !==
      currentRoles.includes(SUPER_ADMIN_ROLE);

    if (!changes) return;
    if (isSuperAdmin(ctx)) return;

    throw superAdminGrantForbidden();
  };

  /**
   * Refuses an action *aimed at* a super admin by somebody who is not one
   * (ADR-0017 §Invariants).
   *
   * The sibling of the rule above, and the reason it is a separate one:
   * `assertMaySetSuperAdmin` protects the *role*, and this protects the
   * *account holding it*. Guarding only the role left the hierarchy inverted
   * from below — an `admin` could not take `super_admin` away, but could
   * `PATCH` a super admin to `disabled`, or call `sessions/revoke` on them in
   * a loop and keep them logged out for as long as they liked. A privilege
   * that can be neutralised by everyone it outranks is not a privilege.
   *
   * Only actions that *remove* standing are refused. An admin may still edit a
   * super admin's name, and may re-activate one — nothing is protected by
   * preventing that.
   */
  const assertMayActOnSuperAdmin = (
    ctx: RequestContext,
    target: StaffRecord,
  ): void => {
    if (!target.roles.includes(SUPER_ADMIN_ROLE)) return;
    if (isSuperAdmin(ctx)) return;

    throw superAdminTargetForbidden();
  };

  const read = async (id: string, tx?: DbExecutor): Promise<StaffRecord> => {
    const record = await repository.findById(id, tx);

    if (record === undefined) throw staffNotFound();

    return record;
  };

  /**
   * Refuses an edit that would leave no active `super_admin` (ADR-0017).
   *
   * Only an account that *is* one right now can be the last one, so the check
   * costs a query exclusively on the edits that could break the invariant.
   */
  const assertSuperAdminSurvives = async (
    current: StaffRecord,
    patch: UpdateStaffBody,
    tx: DbExecutor,
  ): Promise<void> => {
    const isActiveSuperAdmin =
      current.status === "active" && current.roles.includes("super_admin");

    if (!isActiveSuperAdmin) return;

    const losesRole =
      patch.roles !== undefined && !patch.roles.includes("super_admin");
    const losesActive = patch.status !== undefined && patch.status !== "active";

    if (!losesRole && !losesActive) return;

    const others = await repository.countOtherActiveSuperAdmins(current.id, tx);

    if (others === 0) throw lastSuperAdmin();
  };

  return {
    /**
     * `GET /api/v1/admin/staff` (ADR-0014).
     *
     * `_ctx` is unused and still declared: ADR-0010 fixes the context as every
     * service function's first parameter, so a reader — and a caller — sees one
     * shape whether or not this particular function has something to log.
     */
    list: async (
      _ctx: RequestContext,
      query: ListStaffQuery,
    ): Promise<Page<StaffResource>> => {
      const { rows, total } = await repository.list(query);

      return toPage(query, rows.map(toStaffResource), total);
    },

    /** `GET /api/v1/admin/staff/:id`. */
    getById: async (_ctx: RequestContext, id: string): Promise<StaffResource> =>
      toStaffResource(await read(id)),

    /**
     * `POST /api/v1/admin/staff` (ADR-0018 §Staff onboarding).
     *
     * The account and its grants are one transaction: a staff member who
     * exists with no role can sign in and do nothing, which is a support
     * ticket rather than a state worth being able to reach.
     *
     * The password is hashed **outside** the transaction. argon2 holds a libuv
     * thread for ~130 ms, and holding a database connection open across that
     * for no reason is how a burst of creates exhausts the pool.
     */
    create: async (
      ctx: RequestContext,
      body: CreateStaffBody,
    ): Promise<StaffResource> => {
      const grantedBy = actor(ctx).id;

      // A brand-new account holds nothing yet, so any `super_admin` in the
      // body is a grant.
      assertMaySetSuperAdmin(ctx, body.roles, []);

      const passwordHash = await hasher.hash(body.password);

      const created = await transaction(async (tx) => {
        const record = await repository.create(
          {
            email: body.email,
            passwordHash,
            firstName: body.firstName,
            lastName: body.lastName,
          },
          tx,
        );

        if (record === undefined) return undefined;

        await repository.replaceRoles(record.id, body.roles, grantedBy, tx);

        return { ...record, roles: body.roles };
      });

      if (created === undefined) throw staffEmailTaken();

      ctx.logger.info(
        { staffId: created.id, roles: created.roles, grantedBy },
        "staff member created",
      );

      return toStaffResource(created);
    },

    /**
     * `PATCH /api/v1/admin/staff/:id` — profile, roles and status.
     *
     * Everything happens in one transaction because the three writes are one
     * decision: the invariant is checked against the same snapshot the update
     * lands on, and an account being disabled loses its sessions in the same
     * commit. ADR-0018 requires that pairing — `sessions` has no foreign key
     * to `staff`, so nothing else would enforce it, and a gap between the two
     * writes is a window in which a disabled account still holds a valid
     * access token.
     */
    update: async (
      ctx: RequestContext,
      id: string,
      body: UpdateStaffBody,
    ): Promise<StaffResource> => {
      const grantedBy = actor(ctx).id;
      const at = now();

      const { updated, revoked } = await transaction(async (tx) => {
        // Before the read, because the read is what the invariant check below
        // reasons about and a count cannot see an uncommitted sibling.
        await repository.lockRoleInvariant(tx);

        const current = await read(id, tx);

        // Privilege first, then the invariant: "you may not do this at all"
        // outranks "the system will not let anyone do this right now".
        assertMaySetSuperAdmin(ctx, body.roles, current.roles);

        // Disabling a super admin is removing their standing, so it needs the
        // same rank as demoting them. Re-activating one does not.
        if (body.status !== undefined && body.status !== "active") {
          assertMayActOnSuperAdmin(ctx, current);
        }

        await assertSuperAdminSurvives(current, body, tx);

        await repository.updateColumns(
          id,
          {
            firstName: body.firstName,
            lastName: body.lastName,
            status: body.status,
          },
          at,
          tx,
        );

        if (body.roles !== undefined) {
          await repository.replaceRoles(id, body.roles, grantedBy, tx);
        }

        const deactivated =
          body.status !== undefined &&
          body.status !== "active" &&
          current.status === "active";

        // A role change has to end the account's sessions, and this is not
        // housekeeping — it is what makes the change take effect at all.
        // `authorize` reads roles from the access token's claims (ADR-0018),
        // which are up to `JWT_ACCESS_TTL` stale. That was harmless while
        // roles were immutable at runtime; now a demoted admin keeps admin
        // for the rest of the token's life, which is long enough to call this
        // very endpoint and put the role back. Left unrevoked, a demotion is
        // not slow — it is reversible by its own subject.
        const rolesChanged =
          body.roles !== undefined && !sameRoles(body.roles, current.roles);

        const revokedCount =
          deactivated || rolesChanged
            ? await sessions.revokeSessionsFor(ctx, {
                principalId: id,
                reason: deactivated
                  ? REVOKE_REASONS.accountDisabled
                  : REVOKE_REASONS.rolesChanged,
                tx,
              })
            : 0;

        // Re-read rather than assemble: the roles may have been replaced and
        // `updatedAt` was written by the update above, so the row is the only
        // honest source for what the client is about to be told.
        return { updated: await read(id, tx), revoked: revokedCount };
      });

      ctx.logger.info(
        { staffId: id, status: updated.status, roles: updated.roles, revoked },
        "staff member updated",
      );

      return toStaffResource(updated);
    },

    /**
     * `POST /api/v1/admin/staff/:id/sessions/revoke` — the forced logout.
     *
     * The account is read first so an unknown id answers `404` instead of a
     * silent success; a revoke of an account with no live session is otherwise
     * legitimately a no-op, and the two must not look the same.
     */
    revokeSessions: async (ctx: RequestContext, id: string): Promise<void> => {
      const record = await read(id);

      // Ending somebody's sessions is removing their standing, so it carries
      // the same rank requirement as disabling them. Without this an `admin`
      // could keep every super admin permanently logged out.
      assertMayActOnSuperAdmin(ctx, record);

      const revoked = await sessions.revokeSessionsFor(ctx, {
        principalId: record.id,
        reason: REVOKE_REASONS.adminRevoke,
      });

      ctx.logger.info(
        { staffId: record.id, revoked, by: actor(ctx).id },
        "staff sessions revoked by an admin",
      );
    },
  } as const;
};

export type StaffService = ReturnType<typeof createStaffService>;
