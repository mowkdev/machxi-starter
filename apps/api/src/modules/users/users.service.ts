import type {
  ChangePasswordBody,
  CreateUserBody,
  ListUsersQuery,
  Page,
  UpdateProfileBody,
  UpdateUserBody,
  UserResource,
  UserRole,
} from "@repo/contracts";
import type { DbExecutor } from "@repo/db";

import type { LimitedHasher } from "../../core/auth/index.js";
import { requirePopulation } from "../../core/auth/index.js";
import type { RequestContext } from "../../core/context/index.js";
import { toPage } from "../../core/http/index.js";
import { REVOKE_REASONS, type AuthService } from "../auth/index.js";
import {
  currentPasswordInvalid,
  userEmailTaken,
  userNotFound,
} from "./users.errors.js";
import { toUserResource } from "./users.mapper.js";
import type { UserRecord, UsersRepository } from "./users.repository.js";

/**
 * The users module's business logic (ADR-0009).
 *
 * One service for two segments, because they are two views of one aggregate:
 * `/api/v1/admin/users` is staff acting on somebody else's account, and
 * `/api/v1/user/profile` is a user acting on their own. Splitting them would
 * mean two copies of "what a user is" and two places to change when it grows.
 *
 * What keeps them apart is not the file boundary but the argument: the admin
 * functions take an `id` from the URL, and the profile functions take no id at
 * all and read it from `ctx.principal`. That is the ownership rule of ADR-0019
 * §3 made structural — there is no id for a user to tamper with, so no
 * ownership check to forget.
 */

/** v1 has exactly one user role, and an account with none can do nothing. */
const DEFAULT_USER_ROLES: readonly UserRole[] = ["customer"];

/** Whether two role sets are the same set, order and duplicates aside. */
const sameRoles = (
  next: readonly UserRole[],
  current: readonly UserRole[],
): boolean => {
  const a = new Set(next);
  const b = new Set(current);

  return a.size === b.size && [...a].every((role) => b.has(role));
};

export interface UsersServiceDeps {
  readonly repository: UsersRepository;
  /** Already wrapped in the process-wide concurrency cap (ADR-0020). */
  readonly hasher: LimitedHasher;
  /**
   * The auth module's session revocation, bound to the `user` population by
   * the container. Narrowed to the one function this service may call: a
   * module depends on another module's *service*, never its repository
   * (ADR-0009).
   */
  readonly sessions: Pick<AuthService, "revokeSessionsFor">;
  /** Runs `fn` inside one database transaction (ADR-0006). */
  readonly transaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  readonly now?: () => Date;
}

export const createUsersService = ({
  repository,
  hasher,
  sessions,
  transaction,
  now = () => new Date(),
}: UsersServiceDeps) => {
  /**
   * The account acting on itself — `/api/v1/user/profile` (ADR-0019 §3).
   *
   * Unannotated on purpose: `requirePopulation` is generic and returns the
   * *narrowed* member, so this is a user principal with `UserRole[]` rather
   * than the union. Writing `: Principal` here would throw that away and cost
   * the first user-role rule a cast.
   */
  const self = (ctx: RequestContext) => requirePopulation(ctx, "user");

  /** The admin view: soft-deleted rows included, because an admin may open one. */
  const readAny = async (id: string, tx?: DbExecutor): Promise<UserRecord> => {
    const record = await repository.findAnyById(id, tx);

    if (record === undefined) throw userNotFound();

    return record;
  };

  /**
   * The self view: soft-deleted rows excluded.
   *
   * Reachable only if the account was deleted inside its access token's
   * lifetime, which `authenticate` cannot see — it verifies the session, not
   * the account (ADR-0018). `404` is the honest answer: the profile is gone.
   */
  const readSelf = async (id: string, tx?: DbExecutor): Promise<UserRecord> => {
    const record = await repository.findById(id, tx);

    if (record === undefined) throw userNotFound();

    return record;
  };

  return {
    /**
     * `GET /api/v1/admin/users` (ADR-0014).
     *
     * `_ctx` is unused and still declared: ADR-0010 fixes the context as every
     * service function's first parameter, so a reader — and a caller — sees one
     * shape whether or not this particular function has something to log.
     */
    list: async (
      _ctx: RequestContext,
      query: ListUsersQuery,
    ): Promise<Page<UserResource>> => {
      const { rows, total } = await repository.list(query);

      return toPage(query, rows.map(toUserResource), total);
    },

    /** `GET /api/v1/admin/users/:id`. */
    getById: async (_ctx: RequestContext, id: string): Promise<UserResource> =>
      toUserResource(await readAny(id)),

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

      const created = await transaction(async (tx) => {
        const record = await repository.create(
          {
            email: body.email,
            passwordHash,
            firstName: body.firstName,
            lastName: body.lastName,
            status: body.status,
          },
          tx,
        );

        if (record === undefined) return undefined;

        await repository.replaceRoles(record.id, roles, tx);

        return { ...record, roles };
      });

      if (created === undefined) throw userEmailTaken();

      ctx.logger.info(
        { userId: created.id, status: created.status },
        "user created by staff",
      );

      return toUserResource(created);
    },

    /**
     * `PATCH /api/v1/admin/users/:id` — profile, roles and status.
     *
     * One transaction, because the writes are one decision: an account being
     * moved off `active` loses its sessions in the same commit. ADR-0018
     * requires that pairing — `sessions` has no foreign key to `users`, so
     * nothing else enforces it, and a gap between the two writes is a window
     * in which a disabled account still holds a valid access token.
     */
    update: async (
      ctx: RequestContext,
      id: string,
      body: UpdateUserBody,
    ): Promise<UserResource> => {
      const at = now();

      const { updated, revoked } = await transaction(async (tx) => {
        const current = await readAny(id, tx);

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
          await repository.replaceRoles(id, body.roles, tx);
        }

        const deactivated =
          body.status !== undefined &&
          body.status !== "active" &&
          current.status === "active";

        // Roles ride in the access token's claims (ADR-0018), so a role that
        // is changed but not revoked does not take effect until the token
        // expires. `customer` is the only user role in v1 and gates nothing,
        // so today this changes no outcome — it is here because the staff
        // module needs the same rule for a reason that *is* live (a demoted
        // admin can otherwise re-promote themselves), and a rule that holds in
        // one module and silently not the other is the kind of difference that
        // is only noticed once `premium` or `vendor` arrives (ADR-0017).
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

        // Re-read rather than assemble: roles may have been replaced and
        // `updatedAt` was written by the update above, so the row is the only
        // honest source for what the client is about to be told.
        return { updated: await readAny(id, tx), revoked: revokedCount };
      });

      ctx.logger.info(
        { userId: id, status: updated.status, revoked },
        "user updated by staff",
      );

      return toUserResource(updated);
    },

    /**
     * `POST /api/v1/admin/users/:id/sessions/revoke` — the forced logout.
     *
     * The account is read first so an unknown id answers `404` rather than a
     * silent success: revoking an account with no live session is legitimately
     * a no-op, and the two must not look the same.
     */
    revokeSessions: async (ctx: RequestContext, id: string): Promise<void> => {
      const record = await readAny(id);

      const revoked = await sessions.revokeSessionsFor(ctx, {
        principalId: record.id,
        reason: REVOKE_REASONS.adminRevoke,
      });

      ctx.logger.info(
        { userId: record.id, revoked },
        "user sessions revoked by staff",
      );
    },

    /** `GET /api/v1/user/profile` — the caller's own account. */
    getProfile: async (ctx: RequestContext): Promise<UserResource> =>
      toUserResource(await readSelf(self(ctx).id)),

    /**
     * `PATCH /api/v1/user/profile` — names only.
     *
     * `status` and `roles` are absent from `updateProfileBody` by
     * construction, so this cannot re-enable or promote an account however the
     * body is crafted; there is no field to reject at runtime because there is
     * no field.
     */
    updateProfile: async (
      ctx: RequestContext,
      body: UpdateProfileBody,
    ): Promise<UserResource> => {
      const principal = self(ctx);
      const at = now();

      // Refuses a deleted or otherwise unreadable account before writing,
      // rather than letting `updateColumns` quietly match no row.
      await readSelf(principal.id);

      await repository.updateColumns(
        principal.id,
        { firstName: body.firstName, lastName: body.lastName },
        at,
      );

      ctx.logger.info({ userId: principal.id }, "profile updated");

      return toUserResource(await readSelf(principal.id));
    },

    /**
     * `POST /api/v1/user/profile/change-password`.
     *
     * Three decisions worth stating:
     *
     * - **The current password is required** even though the caller already
     *   holds a session. A stolen access token is worth 15 minutes; a stolen
     *   token that can set a new password is worth the account.
     * - **Every other session is revoked, and this one is not.** A password
     *   change is how somebody ends a session they no longer control, so
     *   leaving the others alive would defeat the point — and logging the
     *   caller out of the device they are holding is a worse experience for no
     *   security gain, since that session is the one they just proved they own.
     * - **An account with no password may not use this endpoint.** `null`
     *   means "no password login" (ADR-0017), and verifying against it would
     *   have to either fail always or succeed always; it fails, through the
     *   same answer a wrong password gets.
     */
    changePassword: async (
      ctx: RequestContext,
      body: ChangePasswordBody,
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
          "password change refused, current password did not verify",
        );

        throw currentPasswordInvalid();
      }

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

      ctx.logger.info({ userId: principal.id, revoked }, "password changed");
    },
  } as const;
};

export type UsersService = ReturnType<typeof createUsersService>;
