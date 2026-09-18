import type {
  CreateUserBody,
  DeleteProfileBody,
  UserResource,
  UserRole,
} from "@repo/contracts";
import type { DbExecutor } from "@repo/db";

import type { LimitedHasher } from "../../core/auth/index.js";
import type { Principal, RequestContext } from "../../core/context/index.js";
import {
  currentPasswordInvalid,
  REVOKE_REASONS,
  type AuthService,
} from "../auth/index.js";
import type { OrganizationsService } from "../organizations/index.js";
import { userDeleted, userEmailTaken, userNotFound } from "./users.errors.js";
import type { UserRecord, UsersRepository } from "./users.repository.js";

/**
 * The account's own lifecycle: the staff-side create, and the two paths that
 * close an account (ADR-0009, ADR-0067 §2).
 *
 * Split out of `users.service.ts` at `D20.7`, and these three because they
 * share an edge no other function in the module has: each of them runs the
 * organizations service's personal-organization write inside the transaction
 * that writes the account (§2), so "a user exists" and "that user has exactly
 * one personal organization" commit together. Keeping the glue in one file is
 * what makes the three call sites readable as one rule rather than as three
 * remembered ones.
 *
 * `createUsersService` composes this and returns its members under their own
 * names, so nothing outside the module knows the file exists: `service.create`,
 * `service.remove` and `service.deleteProfile` are what a controller calls, as
 * before.
 */

/** v1 has exactly one user role, and an account with none can do nothing. */
const DEFAULT_USER_ROLES: readonly UserRole[] = ["customer"];

export interface UsersLifecycleServiceDeps {
  readonly repository: UsersRepository;
  /** Already wrapped in the process-wide concurrency cap (ADR-0020). */
  readonly hasher: LimitedHasher;
  /**
   * The auth module's session revocation, bound to the `user` population by
   * the container (ADR-0009). The same narrowing `UsersServiceDeps` states.
   */
  readonly sessions: Pick<AuthService, "revokeSessionsFor">;
  /**
   * The organizations service, narrowed to the two functions these three
   * writes run inside their own transactions (ADR-0067 §2).
   */
  readonly organizations: Pick<
    OrganizationsService,
    "ensurePersonalOrganizationFor" | "deletePersonalOrganizationFor"
  >;
  /** Runs `fn` inside one database transaction (ADR-0006). */
  readonly transaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  readonly now: () => Date;
  /**
   * The four helpers `createUsersService` builds once and both halves of the
   * module read through — the record views ADR-0028 keeps apart and the
   * presenter that adds each account's identities (ADR-0072 §3).
   *
   * Passed in rather than rebuilt here so there is exactly one definition of
   * "the admin view of a writable subject" and of "the self view", which is
   * the distinction the deleted-account rules rest on.
   */
  readonly self: (ctx: RequestContext) => Extract<Principal, { kind: "user" }>;
  readonly readWritable: (id: string, tx?: DbExecutor) => Promise<UserRecord>;
  readonly readSelf: (id: string, tx?: DbExecutor) => Promise<UserRecord>;
  readonly presentOne: (
    record: UserRecord,
    tx?: DbExecutor,
  ) => Promise<UserResource>;
}

export const createUsersLifecycleService = ({
  repository,
  hasher,
  sessions,
  organizations,
  transaction,
  now,
  self,
  readWritable,
  readSelf,
  presentOne,
}: UsersLifecycleServiceDeps) =>
  ({
    /**
     * `POST /api/v1/admin/users` — staff create an account directly, with an
     * initial password.
     *
     * The account and its grants are one transaction; the hash is computed
     * outside it, because argon2 holds a libuv thread for ~130 ms and holding
     * a database connection across that would turn a burst of creates into
     * pool exhaustion (ADR-0020).
     */
    create: async (
      ctx: RequestContext,
      body: CreateUserBody,
    ): Promise<UserResource> => {
      const roles = body.roles ?? DEFAULT_USER_ROLES;
      const passwordHash = await hasher.hash(body.password);
      const at = now();

      const created = await transaction(async (tx) => {
        const record = await repository.create(
          {
            email: body.email,
            passwordHash,
            firstName: body.firstName,
            lastName: body.lastName,
            status: body.status,
            /*
             * The staff member who types the address is the **assertion** that
             * proves it (ADR-0071 §3): they are the authority a confirmation
             * link would be asking, so no link is sent and the stamp is
             * written with the row. That is what keeps "every `active` user
             * has a proven address" true of this path as well as of
             * registration's.
             *
             * Except when the caller asks for `pending_verification`, which is
             * an admin deliberately creating an account that has proven
             * nothing — the same row the `--dev` fixtures carry and the
             * backfill migration skipped. Stamping it would make
             * `email_verified_at` disagree with `status` on the one status the
             * verification flow exists to move.
             */
            ...(body.status === "pending_verification"
              ? {}
              : { emailVerifiedAt: at }),
          },
          tx,
        );

        if (record === undefined) return undefined;

        await repository.replaceRoles(record.id, roles, tx);

        // The second of the three paths that bring a user into existence, and
        // the personal organization lands in the same commit as the account
        // for the reason registration's does (ADR-0067 §2): a user with no
        // organization is a state no query in this repository has a branch
        // for, and one commit is what makes it unreachable rather than rare.
        // The four fields, not the whole `UserRecord`: `passwordHash` is on
        // that row and the organizations module has no business holding one,
        // even a module that never reads it. The auth service builds the same
        // object by hand at its own call site.
        await organizations.ensurePersonalOrganizationFor(
          ctx,
          {
            id: record.id,
            email: record.email,
            firstName: record.firstName,
            lastName: record.lastName,
          },
          tx,
        );

        return { ...record, roles };
      });

      if (created === undefined) throw userEmailTaken();

      ctx.logger.info(
        { userId: created.id, status: created.status },
        "user created by staff",
      );

      // A new account has linked nothing; the read is the same one every
      // other answer takes, so the shape cannot drift from theirs.
      return presentOne(created);
    },

    /**
     * `DELETE /api/v1/admin/users/:id` — soft delete (ADR-0028).
     *
     * One transaction, three writes: the timestamp, the status, and every live
     * session of the account with reason `account_deleted`.
     *
     * `deleted_at` alone would already stop sign-in — `findByEmail` filters it
     * — so `status` is written for a different reason: to keep `status` a
     * truthful column on its own, since `filter[status][eq]=active` is an
     * allow-listed filter and an active-and-deleted account would satisfy it.
     *
     * The sessions go in the same transaction because `sessions` has no
     * foreign key to `users` (ADR-0018), so nothing else ends them, and any gap
     * between the two writes is a window in which a deleted account still holds
     * a valid access token.
     *
     * Deleting the row is not on the table: a customer record is referenced by
     * future order history. What *is* released is the address — the partial
     * unique index means a deleted account's email can be registered again,
     * which is the support answer this endpoint exists to make possible.
     */
    remove: async (ctx: RequestContext, id: string): Promise<void> => {
      const at = now();

      // Refuses a second delete with `409` rather than moving the timestamp:
      // "already deleted" is a conflict, not a no-op to report as success.
      const record = await readWritable(id);

      const revoked = await transaction(async (tx) => {
        // `softDelete` only matches a *live* row, and its boolean is the one
        // thing that sees a concurrent delete: the read above happened outside
        // this transaction, so two callers can both pass it and the loser
        // would otherwise update nothing and answer `204` for a request the
        // ADR says is a `409`.
        if (!(await repository.softDelete(record.id, at, tx))) {
          throw userDeleted();
        }

        // The account's personal organization goes with it, in this
        // transaction and stamped with the same `at` (ADR-0067 §2). It is the
        // only path by which one is deleted at all — on its own it refuses
        // with `409` — and the team organizations this account owns are
        // deliberately untouched, because other people are in them.
        await organizations.deletePersonalOrganizationFor(
          ctx,
          record.id,
          at,
          tx,
        );

        return sessions.revokeSessionsFor(ctx, {
          principalId: record.id,
          reason: REVOKE_REASONS.accountDeleted,
          tx,
        });
      });

      // A login that read this account before the commit inserts its session
      // *after* the revoke inside it: `login` verifies argon2 outside any
      // transaction, which is ~130 ms of window, and `sessions` has no foreign
      // key to hold it back. One more sweep after the commit narrows that to a
      // single statement. It is a no-op on every ordinary delete.
      const straggler = await sessions.revokeSessionsFor(ctx, {
        principalId: record.id,
        reason: REVOKE_REASONS.accountDeleted,
      });

      ctx.logger.info(
        { userId: record.id, revoked: revoked + straggler },
        "user account deleted",
      );
    },

    /**
     * `DELETE /api/v1/user/profile` — the account closing itself (ADR-0055
     * §4).
     *
     * ADR-0028's user semantics carried exactly: one transaction writing
     * `deleted_at` and `status = 'disabled'`, the row surviving because future
     * order history references it, and the address released by the partial
     * unique index so the same person can come back. The admin `remove` above
     * is the same three writes with a different actor.
     *
     * Two rules the self-service actor adds, both from ADR-0055 §4:
     *
     * - **The current password is required.** A session is not an identity
     *   proof for an irreversible act. `change-password` requires it because a
     *   stolen access token that can set a password is worth the account; this
     *   endpoint is the one operation more destructive than that, so the same
     *   principle applies with more force. It is verified *before* anything is
     *   written, and refused with the same `403` a wrong password gets
     *   anywhere else — including for an account whose `password_hash` is
     *   `null`, which means "no password login" (ADR-0017) and never "any
     *   password matches".
     * - **Every session is revoked, the caller's included**, which is where
     *   this parts company with `changePassword`: there the caller keeps the
     *   session they just proved they own, because the point is to end the
     *   ones they do not control. Here there is no account left to be signed
     *   in to, so no session is spared and `exceptSessionId` is deliberately
     *   absent.
     *
     * A second delete answers `404`, not `409 USER_DELETED`: the admin segment
     * says "the account exists and you may see it, but its state conflicts",
     * and on this segment the self view has already stopped being able to see
     * it — `readSelf` filters `deleted_at`, so every other profile endpoint
     * answers `404` for a deleted account and this one agrees with them.
     */
    deleteProfile: async (
      ctx: RequestContext,
      body: DeleteProfileBody,
    ): Promise<void> => {
      const principal = self(ctx);
      const at = now();
      const record = await readSelf(principal.id);

      const verified =
        record.passwordHash !== null &&
        (await hasher.verify(record.passwordHash, body.currentPassword));

      if (!verified) {
        ctx.logger.warn(
          { userId: principal.id },
          "account deletion refused, current password did not verify",
        );

        throw currentPasswordInvalid();
      }

      const revoked = await transaction(async (tx) => {
        // The boolean is what sees a concurrent delete: `readSelf` ran outside
        // this transaction, so the same account deleting itself from two
        // devices can pass it twice, and the loser would otherwise update
        // nothing and answer `204` for a request that changed nothing.
        if (!(await repository.softDelete(record.id, at, tx))) {
          throw userNotFound();
        }

        // The admin path's twin (ADR-0067 §2): the same write in the same
        // transaction, because which actor closed the account does not change
        // what happens to the organization that exists only for it.
        await organizations.deletePersonalOrganizationFor(
          ctx,
          record.id,
          at,
          tx,
        );

        return sessions.revokeSessionsFor(ctx, {
          principalId: record.id,
          reason: REVOKE_REASONS.accountDeleted,
          tx,
        });
      });

      // The same post-commit sweep the admin delete does, for the same reason:
      // `login` verifies argon2 outside any transaction, and `sessions` has no
      // foreign key to hold a straggler back (ADR-0028 §Consequences, amended).
      // A no-op on every ordinary deletion.
      const straggler = await sessions.revokeSessionsFor(ctx, {
        principalId: record.id,
        reason: REVOKE_REASONS.accountDeleted,
      });

      ctx.logger.info(
        { userId: record.id, revoked: revoked + straggler },
        "user account deleted by its owner",
      );
    },
  }) as const;

export type UsersLifecycleService = ReturnType<
  typeof createUsersLifecycleService
>;
