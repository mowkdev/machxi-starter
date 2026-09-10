import type {
  ChangeEmailBody,
  ChangePasswordBody,
  CreateUserBody,
  DeleteProfileBody,
  ListUsersQuery,
  Page,
  SetEmailBody,
  SetPasswordBody,
  UpdateProfileBody,
  UpdateUserBody,
  UserResource,
  UserRole,
} from "@repo/contracts";
import { TOKEN_PURPOSES } from "@repo/contracts";
import type { DbExecutor } from "@repo/db";

import type { LimitedHasher } from "../../core/auth/index.js";
import { requirePopulation } from "../../core/auth/index.js";
import type { Audit } from "../../core/audit/index.js";
import type { RequestContext } from "../../core/context/index.js";
import { toPage } from "../../core/http/index.js";
import { createMailDelivery } from "../../core/mail/index.js";
import type { MailSender, MailTemplates } from "../../core/mail/index.js";
import type { AccountTokens } from "../../core/tokens/index.js";
import {
  currentPasswordInvalid,
  REVOKE_REASONS,
  type AuthService,
} from "../auth/index.js";
import type { OrganizationsService } from "../organizations/index.js";
import type { SettingsService } from "../settings/index.js";
import type { StaffService } from "../staff/index.js";
import { userDeleted, userEmailTaken, userNotFound } from "./users.errors.js";
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
  /**
   * The staff service, narrowed to the one question this module cannot answer
   * about itself: on `POST /api/v1/admin/users/:id/password` the *actor* is a
   * staff member re-presenting their own password, and this service is bound
   * to the `user` population (ADR-0027 rule 1). Asking the staff module
   * through its service, rather than reading the `staff` table here, is what
   * ADR-0009 requires.
   */
  readonly actors: Pick<StaffService, "verifyActorPassword">;
  /**
   * The organizations service, narrowed to the two functions this module's
   * writes must run inside their own transactions (ADR-0067 §2) — the third
   * service-to-service edge in this file, and the same shape as the two above.
   *
   * `POST /admin/users` is one of the three paths that create a user, so it
   * creates the personal organization in the same commit; both deletion paths
   * soft-delete it in the same commit as the account. A module reaches another
   * module's *service*, never its repository (ADR-0009), which is what keeps
   * "how an organization is created" in one place rather than in three.
   */
  readonly organizations: Pick<
    OrganizationsService,
    "ensurePersonalOrganizationFor" | "deletePersonalOrganizationFor"
  >;
  /**
   * The settings service, narrowed to the one question this module cannot
   * answer about itself: which language the acting account reads
   * (ADR-0046 — a locale is an account fact; ADR-0071 §2 — a message to an
   * account is written in it).
   *
   * The fourth service-to-service edge in this file and the same shape as the
   * three above. `get` reads the row of whichever population `ctx.principal`
   * names, so the caller passes the context and this module never learns that
   * there are two settings tables.
   */
  readonly locales: Pick<SettingsService, "get">;
  /**
   * ADR-0071 §1's mint, for the one flow in this module that mails a link
   * (§6). The consume is the auth module's, because the link is followed
   * without a session.
   */
  readonly accountTokens: AccountTokens;
  /**
   * ADR-0058's writer, for the one row this module writes itself: the super
   * admin's administrative address change (ADR-0071 §7). Passed whole, as the
   * impersonation service takes it — `record` is the transactional discipline
   * that row is written on, and `trail` is what a later best-effort row here
   * would use.
   */
  readonly audit: Audit;
  /** ADR-0066 §1's port. Never a mail client a service imports. */
  readonly mail: MailSender;
  /** ADR-0071 §2's messages, built from the two SPA origins at the root. */
  readonly mailTemplates: MailTemplates;
  /** Runs `fn` inside one database transaction (ADR-0006). */
  readonly transaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  readonly now?: () => Date;
}

export const createUsersService = ({
  repository,
  hasher,
  sessions,
  actors,
  organizations,
  locales,
  accountTokens,
  audit,
  mail,
  mailTemplates,
  transaction,
  now = () => new Date(),
}: UsersServiceDeps) => {
  const { deliverDetached } = createMailDelivery({ mail });
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
   * The admin view of a subject that is about to be **written**.
   *
   * `readAny` tolerates a soft-deleted row because the read endpoints must
   * (`GET /:id` answers `200` for one on purpose); the write endpoints must
   * not, and since D2.4 that difference has a name rather than being the
   * absence of a check. `409`, not `404`: the account exists and the caller may
   * see it — what conflicts is its state (ADR-0028).
   */
  const readWritable = async (
    id: string,
    tx?: DbExecutor,
  ): Promise<UserRecord> => {
    const record = await readAny(id, tx);

    if (record.deletedAt !== null) throw userDeleted();

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
        // `readWritable`, not `readAny`: without it a `PATCH` could set a
        // soft-deleted account back to `active` without clearing `deleted_at`,
        // producing a row that is simultaneously active and deleted — a state
        // no reader is written to expect (ADR-0028).
        const current = await readWritable(id, tx);

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
      const record = await readWritable(id);

      const revoked = await sessions.revokeSessionsFor(ctx, {
        principalId: record.id,
        reason: REVOKE_REASONS.adminRevoke,
      });

      ctx.logger.info(
        { userId: record.id, revoked },
        "user sessions revoked by staff",
      );
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
     * `POST /api/v1/admin/users/:id/password` — staff set a customer's
     * password (ADR-0027 §Administrative reset).
     *
     * The actor's own password is verified **first**, before the subject is
     * read: a wrong one then answers the same `403` whether or not the id
     * exists, and no argon2 hash is bought for a request that is about to be
     * refused. There is no rank rule to apply — the `users` population has no
     * role that outranks staff — so what remains is the write and the
     * revocation, in one transaction.
     *
     * Every session of the subject ends, with no exception: the self-service
     * case below spares the caller because the caller proved ownership, and
     * here the subject proved nothing.
     */
    setPassword: async (
      ctx: RequestContext,
      id: string,
      body: SetPasswordBody,
    ): Promise<void> => {
      const at = now();

      await actors.verifyActorPassword(ctx, body.currentPassword);

      // A deleted account cannot sign in at all, so setting its password is
      // not dangerous — it is meaningless, and answering `409` says so rather
      // than reporting success for a credential nobody can use (ADR-0028).
      const record = await readWritable(id);
      const passwordHash = await hasher.hash(body.password);

      const revoked = await transaction(async (tx) => {
        await repository.updatePasswordHash(record.id, passwordHash, at, tx);

        // The administrative twin of `changePassword`'s sweep, and it belongs
        // here more than there: the plausible reason for a staff reset is that
        // the account is compromised, so a `change_email` link the attacker
        // asked for is exactly what must not survive it.
        await accountTokens.supersede(
          ctx,
          {
            purpose: "change_email",
            principal: { type: "user", id: record.id },
          },
          tx,
        );

        return sessions.revokeSessionsFor(ctx, {
          principalId: record.id,
          reason: REVOKE_REASONS.passwordReset,
          tx,
        });
      });

      ctx.logger.info(
        { userId: record.id, revoked },
        "user password reset by staff",
      );
    },

    /**
     * `POST /api/v1/admin/users/:id/email` — a super admin setting a
     * customer's address outright (ADR-0071 §7).
     *
     * **The administrative twin of §6, and deliberately not its shape.** The
     * self-service change mails a link and changes nothing, because the caller
     * has typed a mailbox they may not own. Here the caller is the authority
     * that link would be asking, so the address is written on the spot and
     * counts as **asserted** (§3) — there is nobody left to ask.
     *
     * The order is `setPassword`'s, for `setPassword`'s reasons. The actor's
     * own password is verified **first**, before the subject is read, so a
     * wrong one answers the same `403` whether or not the id exists and the
     * endpoint is no enumeration oracle. Only then the subject, refused with
     * `409 USER_DELETED` if the row is soft-deleted (ADR-0028).
     *
     * The uniqueness question is asked twice: once here, so the answer is
     * `USER_EMAIL_TAKEN` rather than the generic conflict a unique index
     * raises, and once inside the statement that writes (`NOT EXISTS` in the
     * repository). The subject's *own* current address counts as taken, which
     * is §6's rule and the truthful one — it is held by a live account, and a
     * "change" to the address the row already has would write an audit row
     * about nothing.
     *
     * **The stamp follows `create`'s split rather than being unconditional.**
     * An `active` or `disabled` row is stamped: a staff member typing the
     * address is what proves it. A `pending_verification` row is not — that
     * status means an account which has proven nothing, and stamping it would
     * make `email_verified_at` disagree with `status` on the one row the
     * verification flow exists to move. What it *does* get is the new address
     * on the row, so a resend goes to the mailbox the operator corrected.
     *
     * **Every live link the account holds dies with the old address**, on the
     * mechanism §6 already added to every path that writes a password hash
     * (amended at `D18.10`). Each of them was mailed to the mailbox this
     * request exists to stop trusting, and none of them binds to an address —
     * they bind to the account. The loop below says which, and why the first
     * draft's `change_email`-only version was the smaller half of the hole.
     */
    setEmail: async (
      ctx: RequestContext,
      id: string,
      body: SetEmailBody,
    ): Promise<void> => {
      const at = now();

      await actors.verifyActorPassword(ctx, body.currentPassword);

      // The cheap refusals, outside the transaction: an unknown id and a
      // deleted subject are named here so the caller gets `404` and `409
      // USER_DELETED` rather than the uniqueness clause's answer. Authority
      // belongs to the re-read inside, which is `setPassword`'s "checked twice,
      // and the second one counts" (`D18.10`'s `security-reviewer`).
      await readWritable(id);

      if (await repository.emailTaken(body.email)) {
        ctx.logger.warn(
          { userId: id },
          "address set refused, the address is taken",
        );

        throw userEmailTaken();
      }

      await transaction(async (tx) => {
        // Inside, because two things are read off it that the write depends
        // on: the status that decides the stamp, and the address the audit row
        // records as the previous one. Read on the pooled client, a `PATCH` or
        // a §6 confirmation committing in between would make the trail name an
        // address the account had already left.
        const record = await readWritable(id, tx);

        const updated = await repository.setEmail(
          record.id,
          body.email,
          // `create`'s split (ADR-0071 §3): asserted for a row that is usable,
          // null for one that has proven nothing.
          record.status === "pending_verification" ? null : at,
          at,
          tx,
        );

        // The statement's own uniqueness clause found what the read above did
        // not — an address claimed in between. The throw is what rolls the
        // write back.
        if (updated === undefined) throw userEmailTaken();

        /*
         * **Every live link this account holds dies with the old address**
         * (`D18.10`'s `security-reviewer`; ADR-0071 §7, amended).
         *
         * The first draft superseded `change_email` alone, on §6's argument
         * that a pending address change is a credential the session sweep
         * cannot see. The other purposes bind to the **principal id** and
         * never to the address, so each was a link mailed to the mailbox this
         * request exists to stop trusting — and two of them are sharper than
         * the one that was closed: `verify_email` activates the row *and*
         * stamps the new address proven *and* issues a session, which is the
         * exact case §7's amendment names ("an operator correcting the mailbox
         * a link is about to be resent to"); `reset_password` sets a password
         * on an account whose sessions this endpoint deliberately leaves alone.
         *
         * Iterated over `TOKEN_PURPOSES` rather than listed, so the rule is
         * "an address change spends every link" and a fifth purpose is covered
         * on the day it is declared. A purpose that should *survive* an
         * address change has to say so here, which is the safe direction for
         * the omission to point.
         */
        for (const purpose of TOKEN_PURPOSES) {
          await accountTokens.supersede(
            ctx,
            { purpose, principal: { type: "user", id: record.id } },
            tx,
          );
        }

        // Both addresses, because ADR-0071 §7 requires the trail to name them,
        // and the subject, because the actor here is somebody else — the
        // acting super admin, whom `audit.record` reads off `ctx.principal`.
        // `actingAs` stays empty: the request ran as the operator and not as
        // the customer, which is the distinction ADR-0058 draws.
        await audit.record(
          ctx,
          {
            event: "account.email_changed",
            data: {
              subjectType: "user",
              subjectId: record.id,
              previousEmail: record.email,
              newEmail: body.email,
            },
          },
          tx,
        );
      });

      // No address on the line, and the reason is not `newEmail`'s redaction —
      // this body's field is `email`, which ADR-0005 deliberately does **not**
      // redact, because an address is ordinary personal data almost everywhere
      // it appears. So no line in this function may carry the body: the two
      // addresses belong in the audit row, which is not shipped to a log sink.
      ctx.logger.info({ userId: id }, "user address set by a super admin");
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

        // In the same commit as the new hash, and for the reason the session
        // sweep beside it is (`D18.9`'s `security-reviewer`): a pending
        // `change_email` link is a credential this account did not choose and
        // this sweep cannot see, mailed to an address somebody else typed. An
        // attacker who briefly held the password would otherwise still own the
        // account an hour after it was taken back — the link confirms, the
        // address moves, and the next `forgot` goes to their mailbox.
        await accountTokens.supersede(
          ctx,
          {
            purpose: "change_email",
            principal: { type: "user", id: principal.id },
          },
          tx,
        );

        return sessions.revokeSessionsFor(ctx, {
          principalId: principal.id,
          reason: REVOKE_REASONS.passwordChanged,
          exceptSessionId: principal.sessionId,
          tx,
        });
      });

      ctx.logger.info({ userId: principal.id, revoked }, "password changed");
    },

    /**
     * `POST /api/v1/user/profile/change-email` — asking to move the account to
     * a new address (ADR-0071 §6).
     *
     * **Nothing here changes an address**, and that is the whole design rather
     * than a limitation. The caller has typed a mailbox; typing it is not
     * evidence of owning it. So this verifies who is asking, refuses an
     * address a live account already holds, puts the requested address in a
     * single-use token's payload and mails **the new address** a link. The
     * account is untouched until `POST /public/auth/confirm-email` claims that
     * token (the auth module, because the link is followed from a mailbox
     * rather than from this session).
     *
     * **The current password is required**, for the reason ADR-0027 requires
     * it on a password change and with more force: an address change redirects
     * every future recovery link, so an access token that could move an
     * address would be worth the account outright. `changePassword`'s
     * refusal, to the letter — including for an account whose `password_hash`
     * is `null`, which means "no password login" (ADR-0017) and never "any
     * password matches".
     *
     * **The route refuses an impersonated session** (ADR-0057 §5, mounted in
     * `users.routes.ts`), which is the same sentence read from the other end:
     * the operation this endpoint starts is exactly the takeover a support
     * operator must not be able to perform.
     *
     * The locale is the **account's**, read through the settings service
     * (ADR-0071 §2, ADR-0046): this caller is an account, so unlike
     * registration or an invitation to a stranger there is a stored fact to
     * read and no reason to let a client name the language its own row
     * already states. It travels into the token's payload beside the address,
     * because the notice the *old* address receives is sent from an anonymous
     * endpoint that has no principal to read it from.
     */
    requestEmailChange: async (
      ctx: RequestContext,
      body: ChangeEmailBody,
    ): Promise<void> => {
      const principal = self(ctx);
      const record = await readSelf(principal.id);

      const verified =
        record.passwordHash !== null &&
        (await hasher.verify(record.passwordHash, body.currentPassword));

      if (!verified) {
        ctx.logger.warn(
          { userId: principal.id },
          "address change refused, current password did not verify",
        );

        throw currentPasswordInvalid();
      }

      // The caller's own address included, deliberately: it is held by a live
      // account — theirs — so "already taken" is the truthful answer, and a
      // flow that mailed a confirmation link for an address the account
      // already has would spend a message to change nothing.
      if (await repository.emailTaken(body.newEmail)) {
        ctx.logger.warn(
          { userId: principal.id },
          "address change refused, the new address is taken",
        );

        throw userEmailTaken();
      }

      const { locale } = await locales.get(ctx);

      const { token } = await accountTokens.mint(ctx, {
        purpose: "change_email",
        principal: { type: "user", id: principal.id },
        // The address lives here until the link is followed, which is what
        // ADR-0071 §1 gave the column for; the locale rides with it so the
        // anonymous confirmation can write the old address's notice in this
        // account's language. Both are redacted in logs (ADR-0005).
        payload: { newEmail: body.newEmail, locale },
      });

      deliverDetached(
        ctx,
        body.newEmail,
        { population: "user", purpose: "change_email" },
        mailTemplates.confirmEmailChange({
          token,
          locale,
          newEmail: body.newEmail,
        }),
      );

      // The **new** address is not on the line and the account id is: this row
      // is the operational half of the flow, and the address it names is one
      // the account does not hold yet — it belongs in the token, which is
      // deleted by the sweep, rather than in whatever ships the logs
      // (ADR-0005's `newEmail` path exists for exactly this).
      ctx.logger.info(
        { userId: principal.id },
        "address change requested, confirmation link sent",
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
  } as const;
};

export type UsersService = ReturnType<typeof createUsersService>;
