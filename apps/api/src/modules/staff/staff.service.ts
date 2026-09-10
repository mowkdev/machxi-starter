import type {
  ChangePasswordBody,
  CreateStaffBody,
  ListStaffQuery,
  Page,
  SetEmailBody,
  SetPasswordBody,
  StaffResource,
  StaffRole,
  UpdateStaffBody,
  UpdateStaffProfileBody,
} from "@repo/contracts";
import { SUPER_ADMIN_ROLE, TOKEN_PURPOSES } from "@repo/contracts";
import type { DbExecutor } from "@repo/db";

import type { LimitedHasher } from "../../core/auth/index.js";
import { requirePopulation } from "../../core/auth/index.js";
import type { Audit } from "../../core/audit/index.js";
import type { RequestContext } from "../../core/context/index.js";
import { toPage } from "../../core/http/index.js";
import type { AccountTokens } from "../../core/tokens/index.js";
import {
  currentPasswordInvalid,
  REVOKE_REASONS,
  type AuthService,
} from "../auth/index.js";
import {
  lastSuperAdmin,
  selfDeletionForbidden,
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
  /**
   * ADR-0058's writer, for the one row this module writes itself: the super
   * admin's administrative address change (ADR-0071 §7). Passed whole, as the
   * users service takes it.
   */
  readonly audit: Audit;
  /**
   * ADR-0071 §1's token service, for the one thing this module has to say
   * about tokens it does not mint: an administrative address change spends
   * **every** live link the subject holds, because each one was mailed to the
   * mailbox the change exists to stop trusting (§7, amended at `D18.10`).
   */
  readonly accountTokens: AccountTokens;
  /** Runs `fn` inside one database transaction (ADR-0006). */
  readonly transaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  readonly now?: () => Date;
}

export const createStaffService = ({
  repository,
  hasher,
  sessions,
  audit,
  accountTokens,
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

  /**
   * The acting staff member re-presents their own password (ADR-0027 rule 1).
   *
   * The cheapest step-up authentication available in a repository that has no
   * re-authentication category, and what stops a stolen access token from
   * being an account-takeover engine: without it, fifteen minutes of a
   * compromised admin token is enough to set a new password on every
   * non-super-admin operator and every customer.
   *
   * Exported on the service because the *users* module needs the same check
   * for `POST /api/v1/admin/users/:id/password` — the actor there is a staff
   * member, so the question belongs to this aggregate, and a module reaches
   * another module through its service rather than its repository (ADR-0009).
   */
  const verifyActorPassword = async (
    ctx: RequestContext,
    currentPassword: string,
  ): Promise<void> => {
    const principal = actor(ctx);
    const record = await repository.findById(principal.id);

    // A missing actor row answers the same `403` a wrong password does, rather
    // than `read`'s `404`. Two reasons: the caller cannot prove anything either
    // way, so the answers should not differ; and this function is called from
    // the *users* module too, where "Staff member not found" would read as a
    // statement about the subject of `POST /admin/users/:id/password` and be
    // exactly wrong (ADR-0013 — the message is developer-facing, but it must
    // not describe the wrong thing). Reachable once D2.4 can delete a staff
    // account inside its access token's remaining life.
    // `passwordHash !== null` before the verify, since ADR-0071 §8 made the
    // column nullable: an `invited` operator has no password, so there is
    // nothing for a current-password check to succeed against. The same shape
    // the users service has used since D1 — `null` is "no password login",
    // never "any password matches", and the guard is what keeps the two
    // readings apart. Unreachable through the guards today, because an
    // `invited` row cannot hold a session to act with; written anyway, because
    // the type is what makes that argument checkable rather than remembered.
    if (
      record !== undefined &&
      record.passwordHash !== null &&
      (await hasher.verify(record.passwordHash, currentPassword))
    ) {
      return;
    }

    ctx.logger.warn(
      { staffId: principal.id },
      "credential change refused, the actor's current password did not verify",
    );

    throw currentPasswordInvalid();
  };

  return {
    verifyActorPassword,

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

    /**
     * `POST /api/v1/admin/staff/:id/password` — an admin sets somebody else's
     * password (ADR-0027 §Administrative reset).
     *
     * The order of the three checks is the decision worth reading:
     *
     * 1. **The actor's own password first**, before the subject is even read.
     *    A wrong one therefore answers the same `403` whether or not the id
     *    exists, so the endpoint cannot be used to enumerate accounts by
     *    somebody who cannot use it at all — and it costs no argon2 hash of a
     *    new password that is about to be thrown away.
     * 2. **Then the rank rule.** Setting a super admin's password is removing
     *    their standing in the most complete way available, so it carries the
     *    same guard as disabling or signing them out (ADR-0017 §Invariants).
     * 3. **Then the write**, with the hash computed outside the transaction
     *    for the reason `create` gives.
     *
     * The rank rule is checked **twice**, and the second one is the check that
     * counts. The first runs on the pooled client and exists to refuse cheaply
     * — before an argon2 hash is bought for a request that is about to be
     * thrown away. But a decision made against a snapshot the write does not
     * share is not a decision: a target promoted to `super_admin` between the
     * read and the commit would have its credential rewritten by a plain
     * `admin`. So the transaction takes `lockRoleInvariant` and re-reads, which
     * is exactly what `update` does and for exactly the same reason.
     *
     * Every session of the subject goes, with no exception for anybody: the
     * self-service case spares the caller because the caller proved ownership,
     * and here the subject proved nothing.
     */
    setPassword: async (
      ctx: RequestContext,
      id: string,
      body: SetPasswordBody,
    ): Promise<void> => {
      const at = now();

      await verifyActorPassword(ctx, body.currentPassword);

      // The cheap refusal: an unknown id or an out-of-rank target costs no
      // hash. Authority belongs to the re-read inside the transaction.
      assertMayActOnSuperAdmin(ctx, await read(id));

      const passwordHash = await hasher.hash(body.password);

      const { revoked, targetId } = await transaction(async (tx) => {
        await repository.lockRoleInvariant(tx);

        const target = await read(id, tx);

        assertMayActOnSuperAdmin(ctx, target);

        await repository.updatePasswordHash(target.id, passwordHash, at, tx);

        return {
          targetId: target.id,
          revoked: await sessions.revokeSessionsFor(ctx, {
            principalId: target.id,
            reason: REVOKE_REASONS.passwordReset,
            tx,
          }),
        };
      });

      ctx.logger.info(
        { staffId: targetId, revoked, by: actor(ctx).id },
        "staff password reset by an admin",
      );
    },

    /**
     * `POST /api/v1/admin/staff/:id/email` — a super admin setting an
     * operator's address outright (ADR-0071 §7).
     *
     * The users twin, with two differences that come from the population
     * rather than from the flow:
     *
     * - **No verification stamp.** `staff` has no `email_verified_at`, because
     *   nobody self-registers into this table — every operator's address was
     *   asserted by whoever created the row (ADR-0071 §3).
     * - **No rank rule.** `assertMayActOnSuperAdmin` guards the operations an
     *   `admin` can reach; this route is `authorize("super_admin")`, so the
     *   only caller who arrives already outranks everybody. §7 says so
     *   explicitly, including that a super admin may name their own id. The
     *   last-super-admin invariant is untouched because nothing here writes
     *   `status` or a role.
     *
     * The order is `setPassword`'s: the actor's own password first, so a wrong
     * one answers the same `403` whether or not the id exists; then the
     * subject; then the write. The address the subject already holds is
     * refused too, with the same `409 STAFF_EMAIL_TAKEN`: it is held by a live
     * account, and §7 says uniqueness among live accounts is what this refuses.
     *
     * **No session is revoked**, and it is worth saying why not, since the two
     * neighbouring endpoints revoke everything: an address is not a credential
     * (ADR-0071 §6 says so for the self-service half). What sessions authorise
     * is unchanged, and an operator signed out of the panel because somebody
     * corrected a typo in their address would be a worse outcome for no gain.
     */
    setEmail: async (
      ctx: RequestContext,
      id: string,
      body: SetEmailBody,
    ): Promise<void> => {
      const at = now();

      await verifyActorPassword(ctx, body.currentPassword);

      // The cheap refusal, outside the transaction: an unknown id costs no
      // uniqueness read. Authority belongs to the re-read inside, which is the
      // shape `setPassword` already uses for the rank rule.
      await read(id);

      // The subject's own address included, exactly as ADR-0071 §6's request
      // half includes the caller's: it is held by a live account, so "already
      // taken" is truthful, and a change to the address the row already has
      // would write an audit row about nothing.
      if (await repository.emailTaken(body.email)) {
        ctx.logger.warn(
          { staffId: id },
          "address set refused, the address is taken",
        );

        throw staffEmailTaken();
      }

      await transaction(async (tx) => {
        // Inside, because the address the audit row records as the previous
        // one comes off it: read on the pooled client, a `PATCH` committing in
        // between would make the trail name an address the row had left.
        const target = await read(id, tx);

        // The statement's own uniqueness clause sees what the read above could
        // not: an address claimed in between. The throw rolls the audit row
        // back with it.
        if (!(await repository.updateEmail(target.id, body.email, at, tx))) {
          throw staffEmailTaken();
        }

        // Every live link this operator holds dies with the old address — the
        // users twin carries the argument in full (`D18.10`'s
        // `security-reviewer`; ADR-0071 §7, amended). Two of these purposes are
        // reachable for staff today: `reset_password`, which §4 mints on the
        // admin segment, and `staff_onboarding`, whose link lives seven days
        // and whose `accept` sets a password and signs the device in (§8).
        for (const purpose of TOKEN_PURPOSES) {
          await accountTokens.supersede(
            ctx,
            { purpose, principal: { type: "staff", id: target.id } },
            tx,
          );
        }

        // The actor is read off `ctx.principal` — the acting super admin — and
        // the subject rides in `data`, because the request ran *as* the
        // operator and not as the person whose address moved (ADR-0058). Both
        // addresses, which ADR-0071 §7 requires of the trail.
        await audit.record(
          ctx,
          {
            event: "account.email_changed",
            data: {
              subjectType: "staff",
              subjectId: target.id,
              previousEmail: target.email,
              newEmail: body.email,
            },
          },
          tx,
        );
      });

      // No address on the line, and not because of a redaction path: this
      // body's field is `email`, which ADR-0005 deliberately does **not**
      // redact. So no line in this function may carry the body — the two
      // addresses belong in the audit row, which no log sink receives.
      ctx.logger.info(
        { staffId: id, by: actor(ctx).id },
        "staff address set by a super admin",
      );
    },

    /**
     * `DELETE /api/v1/admin/staff/:id` — a hard delete (ADR-0028).
     *
     * The row goes and `staff_roles` cascades with it. There is no
     * `deleted_at` on `staff` and this does not add one: a staff member is a
     * directory entry, where a customer record is referenced by future order
     * history. The cost is stated in the ADR rather than discovered — the
     * answer to "who used to be an admin here" goes with the row, and if that
     * becomes unacceptable the fix is an append-only audit log, not a column.
     *
     * Four rules, in this order:
     *
     * 1. **Nobody deletes themselves.** Checked first and outside the
     *    transaction, because it needs no row: it is the strongest of the four
     *    — "you may not do this at all" outranks "nobody may do this right
     *    now", which is the order `update` already applies to privilege versus
     *    invariant. Running it after the invariant would answer the last super
     *    admin deleting themselves with `409`, when the truthful answer is that
     *    they may never do it at all.
     *
     *    Checked **again** against the row, inside the transaction, and that
     *    is not belt-and-braces for its own sake: the first comparison is
     *    between two strings, and a UUID has more than one spelling. An
     *    uppercased id satisfies `z.uuid()` and matches the row in Postgres
     *    while failing `===` against the principal, which is how this rule was
     *    bypassable until the D2.4 review found it. `idSchema` now lower-cases
     *    on the way in, and `target.id` is whatever the database holds, so the
     *    inner check compares two canonical values and does not depend on the
     *    schema having done its job.
     * 2. **The rank rule.** Deleting a super admin is the most complete removal
     *    of standing there is, so it carries the guard that already covers
     *    disabling and forced logout (ADR-0017 §Invariants).
     * 3. **The last-super-admin invariant**, behind `lockRoleInvariant` —
     *    under READ COMMITTED two concurrent deletes of two different super
     *    admins would each count the other as the survivor and both commit,
     *    leaving a deployment with no super admin and no way back through the
     *    API.
     * 4. **Sessions are revoked before the row goes**, in the same
     *    transaction. `sessions` has no foreign key to `staff` (ADR-0018), so
     *    deleting the principal would otherwise leave live-looking rows behind.
     */
    remove: async (ctx: RequestContext, id: string): Promise<void> => {
      const principal = actor(ctx);

      // The cheap refusal, on the string, so the common case costs no
      // transaction. Case-insensitive because two spellings of one UUID are
      // one id.
      if (id.toLowerCase() === principal.id.toLowerCase()) {
        throw selfDeletionForbidden();
      }

      const revoked = await transaction(async (tx) => {
        // Before the read the invariant rests on, for the reason `update`
        // takes it: a count cannot see an uncommitted sibling.
        await repository.lockRoleInvariant(tx);

        const target = await read(id, tx);

        // The authoritative one: `target.id` is what the database holds, so
        // this compares canonical values whatever the URL said.
        if (target.id === principal.id) throw selfDeletionForbidden();

        assertMayActOnSuperAdmin(ctx, target);

        if (
          target.status === "active" &&
          target.roles.includes(SUPER_ADMIN_ROLE) &&
          (await repository.countOtherActiveSuperAdmins(target.id, tx)) === 0
        ) {
          throw lastSuperAdmin();
        }

        const count = await sessions.revokeSessionsFor(ctx, {
          principalId: target.id,
          reason: REVOKE_REASONS.accountDeleted,
          tx,
        });

        await repository.remove(target.id, tx);

        return count;
      });

      // The same post-commit sweep the users delete takes, and it matters more
      // here: `authenticate` verifies the session and never the principal
      // (ADR-0018), so a session minted by a login that raced this delete is a
      // *deleted operator holding `admin`* for the rest of its access token's
      // life — the row it names is gone, and nothing on the request path looks.
      // Narrowing the window to one statement is what this step can do; closing
      // it needs a per-request principal check, which is a superseding ADR to
      // ADR-0018 rather than a line here (recorded in ADR-0028 §Consequences).
      const straggler = await sessions.revokeSessionsFor(ctx, {
        principalId: id,
        reason: REVOKE_REASONS.accountDeleted,
      });

      ctx.logger.info(
        { staffId: id, revoked: revoked + straggler, by: principal.id },
        "staff account deleted",
      );
    },

    /** `GET /api/v1/admin/profile` — the caller's own account. */
    getProfile: async (ctx: RequestContext): Promise<StaffResource> =>
      toStaffResource(await read(actor(ctx).id)),

    /**
     * `PATCH /api/v1/admin/profile` — names only.
     *
     * `status` and `roles` are absent from `updateStaffProfileBody` by
     * construction, so this cannot re-enable or promote an account however the
     * body is crafted. That is what lets the route carry no `authorize`: an
     * `editor` reaching it can change nothing an `editor` may not change.
     */
    updateProfile: async (
      ctx: RequestContext,
      body: UpdateStaffProfileBody,
    ): Promise<StaffResource> => {
      const principal = actor(ctx);
      const at = now();

      // Refuses an account that is no longer there before writing, rather
      // than letting `updateColumns` quietly match no row.
      await read(principal.id);

      await repository.updateColumns(
        principal.id,
        { firstName: body.firstName, lastName: body.lastName },
        at,
      );

      ctx.logger.info({ staffId: principal.id }, "staff profile updated");

      return toStaffResource(await read(principal.id));
    },

    /**
     * `POST /api/v1/admin/profile/change-password` (ADR-0027).
     *
     * The staff half of the rule `/api/v1/user/profile/change-password`
     * already applied, and the asymmetry ADR-0027 exists to remove: until now
     * an operator's initial password was permanent. The current password is
     * required even though the caller holds a valid session, and every session
     * **except this one** ends — a password change is how somebody ends a
     * session they no longer control, and logging them out of the device in
     * their hand would be worse for no gain.
     *
     * There is no "account with no password" case here, unlike `users`:
     * `staff.password_hash` is `NOT NULL` (ADR-0017), so the record type has
     * no `null` to check for.
     */
    changePassword: async (
      ctx: RequestContext,
      body: ChangePasswordBody,
    ): Promise<void> => {
      const principal = actor(ctx);
      const at = now();

      await verifyActorPassword(ctx, body.currentPassword);

      const passwordHash = await hasher.hash(body.newPassword);

      const revoked = await transaction(async (tx) => {
        await repository.updatePasswordHash(principal.id, passwordHash, at, tx);

        return sessions.revokeSessionsFor(ctx, {
          principalId: principal.id,
          reason: REVOKE_REASONS.passwordChanged,
          exceptSessionId: principal.sessionId,
          tx,
        });
      });

      ctx.logger.info(
        { staffId: principal.id, revoked },
        "staff password changed",
      );
    },
  } as const;
};

export type StaffService = ReturnType<typeof createStaffService>;
