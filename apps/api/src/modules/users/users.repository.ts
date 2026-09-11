import {
  federatedIdentities,
  userRoles,
  users,
  type DbExecutor,
} from "@repo/db";
import type {
  FederatedProvider,
  ListQuery,
  UserRole,
  UserStatus,
} from "@repo/contracts";
import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNull,
  notExists,
  notInArray,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { internal } from "../../core/errors/index.js";
import {
  applyListQuery,
  toSearchCondition,
  type ColumnMap,
  type ListResult,
} from "../../core/http/index.js";

/**
 * Every query against `users` and `user_roles` (ADR-0009).
 *
 * The mirror of `staff.repository.ts`, and deliberately a separate file rather
 * than one parameterised helper: the two tables differ exactly where it
 * matters (nullable names, nullable `password_hash`, soft delete), and a
 * generic "principal repository" would have to erase those differences to
 * exist. What *is* shared is the shape the auth service consumes — the
 * `PrincipalAdapter` in the auth module (ADR-0017).
 */

/** A user row plus its roles — the whole aggregate, read once. */
export interface UserRecord {
  readonly id: string;
  readonly email: string;
  /**
   * `null` for an account with no password login (ADR-0017). The auth service
   * must read that as "this account cannot sign in with a password", never as
   * "any password matches". It is present on the record and absent from the
   * resource, which is what keeps it off the wire (ADR-0012).
   */
  readonly passwordHash: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly status: UserStatus;
  readonly roles: readonly UserRole[];
  readonly lastLoginAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** The soft-delete marker itself, which the resource now reports (ADR-0012). */
  readonly deletedAt: Date | null;
}

/**
 * One external identity linked to an account, as the account's resources
 * carry it (ADR-0072 §3).
 *
 * The provider's `subject` is deliberately not on it: it is the key a sign-in
 * resolves by and nothing a reader of an account needs. It never leaves
 * {@link UsersRepository.findIdentityBySubject}.
 */
export interface IdentityRecord {
  readonly userId: string;
  readonly provider: FederatedProvider;
  readonly email: string | null;
  readonly linkedAt: Date;
}

/** What linking writes (ADR-0072 §1, §3). */
export interface NewIdentityInput {
  readonly userId: string;
  readonly provider: FederatedProvider;
  readonly subject: string;
  /** The address the provider reported, informational only; `null` when it reported none. */
  readonly email: string | null;
  readonly at: Date;
}

/**
 * What self-registration, `POST /api/v1/admin/users` and a sign-in with
 * Google insert.
 */
export interface NewUserInput {
  readonly email: string;
  /**
   * `null` for the one path that creates an account with no password — a
   * sign-in with Google (ADR-0072 §1), the population ADR-0017 reserved the
   * nullable column for. Every other path passes a hash.
   */
  readonly passwordHash: string | null;
  readonly firstName?: string | undefined;
  readonly lastName?: string | undefined;
  /**
   * Defaults to `active`. Self-registration writes `pending_verification`
   * since ADR-0071 §3, and an admin may set any of the three (ADR-0017).
   */
  readonly status?: UserStatus | undefined;
  /**
   * When the address was proven, for a path that **asserts** it (ADR-0071 §3).
   *
   * `POST /api/v1/admin/users` passes the moment of creation: a staff member
   * who types an address is the authority a confirmation link would be asking,
   * so the account is `active` with a proven address in one statement.
   * Registration passes nothing — the link is what proves it — and the column
   * stays null until it is followed.
   */
  readonly emailVerifiedAt?: Date | undefined;
}

/**
 * `PATCH /api/v1/admin/users/:id` and `PATCH /api/v1/user/profile`, column
 * side. Roles live in the join table and are written by
 * {@link UsersRepository.replaceRoles}.
 *
 * The name fields are three-valued on purpose: `undefined` leaves the column
 * alone and `null` clears it. The columns are nullable, so "unset it" is a
 * legal request that a two-valued patch could not express.
 */
export interface UserColumnPatch {
  readonly firstName?: string | null | undefined;
  readonly lastName?: string | null | undefined;
  readonly status?: UserStatus | undefined;
}

const recordColumns = {
  id: true,
  email: true,
  passwordHash: true,
  firstName: true,
  lastName: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as const;

const withRoles = { roles: { columns: { role: true } } } as const;

type UserRowWithRoles = {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly status: UserStatus;
  readonly lastLoginAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
  readonly roles: readonly { readonly role: UserRole }[];
};

const toRecord = (row: UserRowWithRoles): UserRecord => ({
  id: row.id,
  email: row.email,
  passwordHash: row.passwordHash,
  firstName: row.firstName,
  lastName: row.lastName,
  status: row.status,
  lastLoginAt: row.lastLoginAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  deletedAt: row.deletedAt,
  roles: row.roles.map((grant) => grant.role),
});

/**
 * The API field names of `listUsersQuery` mapped to their columns (ADR-0014).
 *
 * Exported for this module's index test (ADR-0060 §3): the rule "a column
 * enters an allow-list only with its index in the same step" is checked by
 * diffing this map against the `users` table's own index declarations, and it
 * has to be *this* map rather than a copy of it to mean anything.
 */
export const listColumns: ColumnMap = {
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
  email: users.email,
  firstName: users.firstName,
  lastName: users.lastName,
  status: users.status,
  lastLoginAt: users.lastLoginAt,
  deletedAt: users.deletedAt,
};

/** The columns `q` reaches, exported with {@link listColumns} and for its reason. */
export const searchColumns = [users.email, users.firstName, users.lastName];

/**
 * A second name for `users`, used only by the address change's `NOT EXISTS`
 * (ADR-0071 §6).
 *
 * The uniqueness question is asked about the table being updated, so the
 * subquery needs a name of its own or every column reference in it is
 * ambiguous. Declared once at module scope because an alias is a compile-time
 * label rather than a per-call value.
 */
const taken = alias(users, "taken_email");

/** The field whose presence in a query means "the client is asking about deletion". */
const DELETED_AT_FIELD = "deletedAt";

export const createUsersRepository = (db: DbExecutor) =>
  ({
    /**
     * By email, excluding soft-deleted rows.
     *
     * `deleted_at is not null` means the account is gone as far as every
     * caller is concerned; returning it here would let a deleted user log in.
     */
    findByEmail: async (
      email: string,
      tx: DbExecutor = db,
    ): Promise<UserRecord | undefined> => {
      const row = await tx.query.users.findFirst({
        columns: recordColumns,
        with: withRoles,
        where: and(eq(users.email, email), isNull(users.deletedAt)),
      });

      return row === undefined ? undefined : toRecord(row);
    },

    /** By id, excluding soft-deleted rows — authentication and `/user/profile`. */
    findById: async (
      id: string,
      tx: DbExecutor = db,
    ): Promise<UserRecord | undefined> => {
      const row = await tx.query.users.findFirst({
        columns: recordColumns,
        with: withRoles,
        where: and(eq(users.id, id), isNull(users.deletedAt)),
      });

      return row === undefined ? undefined : toRecord(row);
    },

    /**
     * By id, **including** soft-deleted rows — the admin endpoints.
     *
     * An admin who can list deleted accounts must be able to open one, and
     * answering `404` for a row they were just shown would be a worse lie than
     * showing it. Nothing on the authentication or self-service paths may use
     * this, which is why it is a separate function rather than a flag.
     */
    findAnyById: async (
      id: string,
      tx: DbExecutor = db,
    ): Promise<UserRecord | undefined> => {
      const row = await tx.query.users.findFirst({
        columns: recordColumns,
        with: withRoles,
        where: eq(users.id, id),
      });

      return row === undefined ? undefined : toRecord(row);
    },

    /**
     * `GET /api/v1/admin/users` (ADR-0014).
     *
     * Soft-deleted rows are hidden **unless the client asks about them**: a
     * list that silently included them would make "the account is gone" untrue
     * for the one screen where it matters most, and one that unconditionally
     * excluded them would make `filter[deletedAt][null]=false` — an allow-listed
     * filter — return nothing forever. So the default scope steps aside as
     * soon as the query mentions `deletedAt`.
     */
    list: async (
      query: ListQuery,
      tx: DbExecutor = db,
    ): Promise<ListResult<UserRecord>> => {
      const asksAboutDeletion = query.filters.some(
        (filter) => filter.field === DELETED_AT_FIELD,
      );

      const plan = applyListQuery(query, {
        columns: listColumns,
        tiebreaker: users.id,
        extraWhere: [
          toSearchCondition(searchColumns, query.q),
          asksAboutDeletion ? undefined : isNull(users.deletedAt),
        ],
      });

      const rows = await tx.query.users.findMany({
        columns: recordColumns,
        with: withRoles,
        where: plan.where,
        orderBy: [...plan.orderBy],
        limit: plan.limit,
        offset: plan.offset,
      });

      /*
       * The aggregate is skipped, not made cheaper, when the caller declines
       * it (ADR-0060 §2). `total: null` is the branch `Page` has typed since
       * D1.4 and `GridPager` has always rendered; before this flag nothing
       * could produce it.
       */
      if (!query.count) return { rows: rows.map(toRecord), total: null };

      const [counted] = await tx
        .select({ total: count() })
        .from(users)
        .where(plan.where);

      return { rows: rows.map(toRecord), total: counted?.total ?? 0 };
    },

    /**
     * Inserts the account, or resolves to `undefined` when the email is taken.
     *
     * `onConflictDoNothing` rather than a prior `select`: two concurrent
     * registrations of the same address would both find nothing and both
     * insert, and the second would surface as an unhandled unique violation.
     * The caller decides what to say about it — a generic `409` for anonymous
     * registration, `USER_EMAIL_TAKEN` for an admin (ADR-0020 §Enumeration).
     *
     * **The conflict target must name the partial index** (ADR-0028). Since
     * D2.4 the uniqueness is `unique (email) where deleted_at is null`, and a
     * bare `target: users.email` matches no index at all: Postgres would raise
     * the unique violation instead of returning no row, this function would
     * throw rather than resolve to `undefined`, and a duplicate registration
     * would answer `500` instead of `CONFLICT`.
     *
     * `where` beside `target` is what makes the inference find it. It is
     * **not** a row filter — drizzle emits it as
     * `on conflict (email) where deleted_at is null do nothing`, where the
     * predicate is Postgres's way of naming which partial index to infer. The
     * plan for this step called the option `targetWhere`, which is
     * `onConflictDoUpdate`'s spelling; `onConflictDoNothing` takes `where`.
     */
    create: async (
      input: NewUserInput,
      tx: DbExecutor = db,
    ): Promise<UserRecord | undefined> => {
      const [created] = await tx
        .insert(users)
        .values({
          email: input.email,
          passwordHash: input.passwordHash,
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
          status: input.status ?? "active",
          emailVerifiedAt: input.emailVerifiedAt ?? null,
        })
        .onConflictDoNothing({
          target: users.email,
          where: isNull(users.deletedAt),
        })
        .returning({
          id: users.id,
          email: users.email,
          passwordHash: users.passwordHash,
          firstName: users.firstName,
          lastName: users.lastName,
          status: users.status,
          lastLoginAt: users.lastLoginAt,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
          deletedAt: users.deletedAt,
        });

      if (created === undefined) return undefined;

      return { ...created, roles: [] };
    },

    /**
     * Writes the column half of a patch. `updatedAt` is set here, not by a
     * trigger (ADR-0006).
     *
     * The `in` checks are `!== undefined` on purpose: `null` is a value that
     * clears the column, and `?? {}` would silently drop it.
     *
     * **Live rows only** (D2.4). The service refuses a deleted subject before
     * calling this, but that read is a check and not a lock: under READ
     * COMMITTED a `PATCH` whose check ran before a concurrent `DELETE`
     * committed will block here, re-evaluate a `where` that still matches, and
     * write `status: 'active'` onto a row that now has `deleted_at` set —
     * which is the "simultaneously active and deleted" state ADR-0028 exists
     * to prevent. The predicate is what makes the refusal hold under
     * concurrency rather than only in sequence.
     *
     * **A move to `active` stamps the address** (ADR-0071 §3). This is the
     * third path that can make a user `active` — beside registration's link
     * and `create` — and it is the one that would otherwise produce
     * `status = 'active'` with an empty `email_verified_at`: an operator
     * clearing a stuck `pending_verification` row from the grid. The invariant
     * §3 buys is what ADR-0067 §5's address-match acceptance and D19's linking
     * rule read `status` alone for, so a row that broke it would turn an
     * address somebody merely typed into proof of a mailbox. The staff member
     * making the change is the same authority `create` treats as an
     * assertion.
     *
     * `coalesce` rather than a conditional in the service: an account that was
     * *already* proven keeps the instant it was proven at, and the rule holds
     * for every transition into `active` — including one this repository
     * cannot see the previous status of, because the update matched it under
     * concurrency rather than the read above.
     *
     * @returns `false` when no **live** row has that id.
     */
    updateColumns: async (
      id: string,
      patch: UserColumnPatch,
      at: Date,
      tx: DbExecutor = db,
    ): Promise<boolean> => {
      const updated = await tx
        .update(users)
        .set({
          ...(patch.firstName === undefined
            ? {}
            : { firstName: patch.firstName }),
          ...(patch.lastName === undefined ? {} : { lastName: patch.lastName }),
          ...(patch.status === undefined ? {} : { status: patch.status }),
          ...(patch.status === "active"
            ? {
                // The cast is not decoration: an untyped bind parameter
                // inside `coalesce` gives Postgres nothing to infer from and
                // the statement is refused outright.
                emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, ${at.toISOString()}::timestamptz)`,
              }
            : {}),
          updatedAt: at,
        })
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .returning({ id: users.id });

      return updated.length > 0;
    },

    /** Idempotent grant; the composite primary key makes a repeat a no-op. */
    grantRole: async (
      userId: string,
      role: UserRole,
      tx: DbExecutor = db,
    ): Promise<void> => {
      await tx.insert(userRoles).values({ userId, role }).onConflictDoNothing();
    },

    /**
     * Makes `roles` the account's exact set of grants.
     *
     * A delete of what is no longer held plus an idempotent insert of what is,
     * so `granted_at` survives on the roles that did not change (ADR-0017).
     */
    replaceRoles: async (
      userId: string,
      roles: readonly UserRole[],
      tx: DbExecutor = db,
    ): Promise<void> => {
      if (roles.length === 0) {
        // Unreachable through the API — `userRolesSchema` requires at least
        // one role — and refused here rather than silently revoking every
        // grant, because `notInArray(column, [])` is not a no-op in SQL.
        throw internal(new Error("users.replaceRoles was given no roles"));
      }

      await tx
        .delete(userRoles)
        .where(
          and(
            eq(userRoles.userId, userId),
            notInArray(userRoles.role, [...roles]),
          ),
        );

      await tx
        .insert(userRoles)
        .values(roles.map((role) => ({ userId, role })))
        .onConflictDoNothing();
    },

    /**
     * The verification link's write (ADR-0071 §3): `pending_verification` →
     * `active`, with the address stamped proven, in one statement.
     *
     * **The `where` is the whole guard.** `status = 'pending_verification'`
     * and `deleted_at is null` are matched inside the update rather than
     * checked on a row read first, so a deleted or disabled account cannot be
     * activated by a link, and two redemptions of one token cannot both find
     * a movable row. No match returns `undefined`, which the caller answers by
     * throwing — and because the consume shares the caller's transaction, a
     * refused verification rolls the token's stamp back and spends nothing
     * (ADR-0071 §1).
     *
     * `email_verified_at` is written unconditionally rather than only when
     * null: the row it moves has never had one, and a coalesce would hide the
     * case where it did.
     */
    markEmailVerified: async (
      id: string,
      at: Date,
      tx: DbExecutor = db,
    ): Promise<UserRecord | undefined> => {
      const [updated] = await tx
        .update(users)
        .set({
          status: "active",
          emailVerifiedAt: at,
          updatedAt: at,
        })
        .where(
          and(
            eq(users.id, id),
            isNull(users.deletedAt),
            eq(users.status, "pending_verification"),
          ),
        )
        .returning({ id: users.id });

      if (updated === undefined) return undefined;

      // Read back through the aggregate read, so the caller gets the roles as
      // well: `returning` cannot reach the join table, and the session this
      // account is about to be issued is minted from `roles`.
      const row = await tx.query.users.findFirst({
        columns: recordColumns,
        with: withRoles,
        where: eq(users.id, id),
      });

      return row === undefined ? undefined : toRecord(row);
    },

    /**
     * "Does a live account already hold this address?" (ADR-0071 §6).
     *
     * The read behind both halves of the address change: the request refuses a
     * taken address with `USER_EMAIL_TAKEN` before anything is mailed, and the
     * confirmation asks again **inside its own transaction**, because an hour
     * can pass between the two and the answer is not a fact the token can
     * carry.
     *
     * Live rows only, which is the partial unique index's own predicate
     * (ADR-0028): a soft-deleted account releases its address, so one holding
     * the string is not a conflict. A boolean rather than a row, because
     * neither caller may learn anything else about an account that is not
     * theirs — the confirmation is served on an **anonymous** route.
     */
    emailTaken: async (email: string, tx: DbExecutor = db): Promise<boolean> =>
      (await tx.query.users.findFirst({
        columns: { id: true },
        where: and(eq(users.email, email), isNull(users.deletedAt)),
      })) !== undefined,

    /**
     * The address change's whole write (ADR-0071 §6): the new address, and
     * `email_verified_at` stamped with it.
     *
     * The stamp moves because the *proof* moved: `email_verified_at` records
     * when the address on this row was proven, and the row now carries an
     * address proven a moment ago by the link being consumed. Leaving the old
     * instant would make the column describe a mailbox the account no longer
     * uses.
     *
     * `status` is deliberately absent and `active` is deliberately in the
     * `where`: this is not a path that activates anything (that is
     * {@link UsersRepository.markEmailVerified}, §3's), and an account
     * disabled or deleted between the request and the click must not be moved
     * by a link. `NOT EXISTS` carries the uniqueness into the same
     * statement, which is not the same as making it atomic: under `read
     * committed` two concurrent confirmations for one free address both see no
     * conflicting row and both attempt the update, and the loser is resolved
     * by `users_email_active_unique` — surfacing as the error handler's
     * generic `409 CONFLICT` rather than `USER_EMAIL_TAKEN`, with its token
     * claim rolled back either way (`D18.9`'s reviewers, both of them). What
     * the clause really buys is the **committed** case, which is the one that
     * happens: an address claimed in the hour since the service asked. The
     * index is the arbiter of the last microsecond, and no duplicate live
     * address is possible on either path.
     *
     * @returns the account as it now stands, or `undefined` when no row
     *   matched — which the caller answers by throwing, so the token's
     *   consumption rolls back with it and the link still works.
     */
    updateEmailVerified: async (
      id: string,
      email: string,
      at: Date,
      tx: DbExecutor = db,
    ): Promise<UserRecord | undefined> => {
      const [updated] = await tx
        .update(users)
        .set({ email, emailVerifiedAt: at, updatedAt: at })
        .where(
          and(
            eq(users.id, id),
            isNull(users.deletedAt),
            eq(users.status, "active"),
            notExists(
              tx
                .select({ one: sql`1` })
                .from(taken)
                .where(and(eq(taken.email, email), isNull(taken.deletedAt))),
            ),
          ),
        )
        .returning({ id: users.id });

      if (updated === undefined) return undefined;

      // Read back through the aggregate read for `markEmailVerified`'s reason:
      // `returning` cannot reach the join table, and every caller of a
      // `UserRecord` expects the grants on it.
      const row = await tx.query.users.findFirst({
        columns: recordColumns,
        with: withRoles,
        where: eq(users.id, id),
      });

      return row === undefined ? undefined : toRecord(row);
    },

    /**
     * The super admin's administrative set (ADR-0071 §7): the address, and the
     * assertion stamp that goes with it.
     *
     * **Not {@link UsersRepository.updateEmailVerified} with a different
     * caller.** That one serves a mailed link, so it matches `status =
     * 'active'` — a link must not move an account somebody disabled while the
     * message sat in a mailbox. Here the actor is a super admin looking at the
     * row, and §7 says "any account": a `disabled` customer whose address a
     * support case has to correct is exactly the case this endpoint exists
     * for. What both refuse is a **deleted** row, which is ADR-0028's rule for
     * every write on this resource and the service's `409 USER_DELETED`.
     *
     * `verifiedAt` is passed rather than derived, because the two halves of
     * §3's invariant are the caller's to decide: an `active` row is stamped —
     * the operator is the authority a link would be asking — and a
     * `pending_verification` one is passed `null`, the same split `create`
     * makes and the same one the backfill migration made. Nothing here writes
     * `status`: setting an address is not an activation.
     *
     * **The column is written unconditionally, `null` included** (`D18.10`'s
     * `security-reviewer`). Skipping the write when `verifiedAt` is `null`
     * would leave the stamp a *previous* address earned, and that is reachable:
     * `updateUserBody.status` accepts the whole enum, and `updateColumns`
     * stamps only on a move **to** `active`, so a proven account patched back
     * to `pending_verification` keeps a non-null stamp. Moving its address
     * without clearing it would leave the row asserting proof of a mailbox
     * nobody has ever answered — the exact disagreement between column and
     * status this split exists to prevent.
     *
     * `NOT EXISTS` carries the uniqueness into the statement for the reason
     * `updateEmailVerified` does, with the same honest limit — under `read
     * committed` the index is the arbiter of the last microsecond, and the
     * clause buys the committed case, which is the one that happens.
     *
     * @returns the account as it now stands, or `undefined` when no row
     *   matched — a deleted row, an unknown id, or an address claimed since
     *   the service asked.
     */
    setEmail: async (
      id: string,
      email: string,
      verifiedAt: Date | null,
      at: Date,
      tx: DbExecutor = db,
    ): Promise<UserRecord | undefined> => {
      const [updated] = await tx
        .update(users)
        .set({ email, emailVerifiedAt: verifiedAt, updatedAt: at })
        .where(
          and(
            eq(users.id, id),
            isNull(users.deletedAt),
            notExists(
              tx
                .select({ one: sql`1` })
                .from(taken)
                .where(and(eq(taken.email, email), isNull(taken.deletedAt))),
            ),
          ),
        )
        .returning({ id: users.id });

      if (updated === undefined) return undefined;

      // Read back through the aggregate read, as every other write here does:
      // `returning` cannot reach the join table and a `UserRecord` carries the
      // grants.
      const row = await tx.query.users.findFirst({
        columns: recordColumns,
        with: withRoles,
        where: eq(users.id, id),
      });

      return row === undefined ? undefined : toRecord(row);
    },

    /**
     * "Is there an account here waiting for its address to be proven?"
     * (ADR-0071 §3).
     *
     * The only read `resend-verification` performs, and deliberately narrower
     * than {@link UsersRepository.findByEmail}: that one returns the password
     * hash, and this one is reached from an anonymous endpoint. It answers
     * `undefined` for an unknown address, an active one, a disabled one and a
     * deleted one alike — every case the endpoint answers `202` to.
     */
    findPendingVerificationByEmail: async (
      email: string,
      tx: DbExecutor = db,
    ): Promise<{ readonly id: string; readonly email: string } | undefined> => {
      const row = await tx.query.users.findFirst({
        columns: { id: true, email: true },
        where: and(
          eq(users.email, email),
          isNull(users.deletedAt),
          eq(users.status, "pending_verification"),
        ),
      });

      return row;
    },

    /**
     * "Is there an account here a recovery link may be sent to?" (ADR-0071 §4).
     *
     * The only read `password/forgot` performs, and narrow for the reason
     * {@link UsersRepository.findPendingVerificationByEmail} is narrow: the
     * caller is anonymous, so it must not be able to reach a password hash
     * through this path however the result is used later.
     *
     * `active` and nothing else. A `pending_verification` row has never proven
     * its address, so mailing a recovery link to it would hand a credential to
     * a mailbox nobody has confirmed; a `disabled` or deleted one cannot sign
     * in with the new password anyway. All three, and an address nobody holds,
     * answer `undefined` — every case the endpoint answers `202` to.
     */
    findActiveByEmail: async (
      email: string,
      tx: DbExecutor = db,
    ): Promise<{ readonly id: string; readonly email: string } | undefined> => {
      const row = await tx.query.users.findFirst({
        columns: { id: true, email: true },
        where: and(
          eq(users.email, email),
          isNull(users.deletedAt),
          eq(users.status, "active"),
        ),
      });

      return row;
    },

    updateLastLoginAt: async (
      id: string,
      at: Date,
      tx: DbExecutor = db,
    ): Promise<void> => {
      await tx
        .update(users)
        .set({ lastLoginAt: at, updatedAt: at })
        .where(eq(users.id, id));
    },

    /** Live rows only, for the reason {@link UsersRepository.updateColumns} is. */
    updatePasswordHash: async (
      id: string,
      passwordHash: string,
      at: Date,
      tx: DbExecutor = db,
    ): Promise<void> => {
      await tx
        .update(users)
        .set({ passwordHash, updatedAt: at })
        .where(and(eq(users.id, id), isNull(users.deletedAt)));
    },

    /**
     * `DELETE /api/v1/admin/users/:id` — the write half of soft deletion
     * (ADR-0028).
     *
     * `status` is written alongside `deleted_at` so that `status` stays a
     * truthful column on its own: `filter[status][eq]=active` is an
     * allow-listed filter on the admin list, and an account that is
     * active-and-deleted would satisfy it. The alternative — a `deleted`
     * member in `USER_STATUSES` — was declined in D1.9, which is why
     * `deletedAt` is on the wire at all.
     *
     * Only live rows match, so a second delete is a no-op rather than a
     * timestamp that moves; the service refuses it before reaching here.
     *
     * **The account's federated identities go with it, hard-deleted on the
     * same executor** (ADR-0072 §1, amended at `D19.1`) — the identity
     * table's version of the partial index that releases the address
     * (ADR-0028). `(provider, subject)` is unique with no predicate, so an
     * identity left on a deleted row would hold the Google account forever:
     * the person could come back with a password and never through Google.
     * Nothing is lost by deleting it — an identity is a way in, and a deleted
     * account has none — and the trail keeps the account's own deletion.
     *
     * @returns `false` when no live row has that id.
     */
    softDelete: async (
      id: string,
      at: Date,
      tx: DbExecutor = db,
    ): Promise<boolean> => {
      const deleted = await tx
        .update(users)
        .set({ deletedAt: at, status: "disabled", updatedAt: at })
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .returning({ id: users.id });

      if (deleted.length === 0) return false;

      await tx
        .delete(federatedIdentities)
        .where(eq(federatedIdentities.userId, id));

      return true;
    },

    /**
     * The identities linked to each of these accounts (ADR-0072 §3), for the
     * resources that carry them — `/user/profile`, `me` and the admin's user
     * resource.
     *
     * One statement for a whole page rather than one per row, and a separate
     * statement rather than a relation on the aggregate read: the aggregate
     * read is also the principal lookup behind every login and refresh, and
     * neither of those needs to know which ways in an account has. It reads
     * `federated_identities_user_id_provider_unique`, which leads with the
     * reference.
     */
    identitiesOf: async (
      userIds: readonly string[],
      tx: DbExecutor = db,
    ): Promise<readonly IdentityRecord[]> => {
      // `inArray(column, [])` is not a no-op in SQL, and an empty page has
      // nothing to look up anyway.
      if (userIds.length === 0) return [];

      return tx
        .select({
          userId: federatedIdentities.userId,
          provider: federatedIdentities.provider,
          email: federatedIdentities.email,
          linkedAt: federatedIdentities.linkedAt,
        })
        .from(federatedIdentities)
        .where(inArray(federatedIdentities.userId, [...userIds]))
        .orderBy(
          asc(federatedIdentities.provider),
          asc(federatedIdentities.linkedAt),
        );
    },

    /**
     * The first question a sign-in asks (ADR-0072 §1): which account, if any,
     * this provider's subject is a way into.
     *
     * By (`provider`, `subject`) and nothing else — whatever address either
     * side carries today. No `deleted_at` filter is needed on the account:
     * deletion deletes the identities in the same transaction
     * ({@link UsersRepository.softDelete}), so an identity always names a live
     * row. The caller reads that row through the aggregate read it already
     * uses, which is also what refuses the case if that ever stops being true.
     */
    findIdentityBySubject: async (
      provider: FederatedProvider,
      subject: string,
      tx: DbExecutor = db,
    ): Promise<{ readonly id: string; readonly userId: string } | undefined> =>
      tx.query.federatedIdentities.findFirst({
        columns: { id: true, userId: true },
        where: and(
          eq(federatedIdentities.provider, provider),
          eq(federatedIdentities.subject, subject),
        ),
      }),

    /**
     * Links an identity to an account (ADR-0072 §1, §3), or resolves to
     * `false` when either uniqueness already holds it — the subject is
     * another account's, or this account already has an identity of this
     * provider.
     *
     * `onConflictDoNothing` with no target, so **both** constraints answer
     * `false` rather than a unique violation the error handler would turn into
     * a `409` on a route whose every answer must be a redirect. Neither
     * conflict is something to retry: the caller refuses.
     */
    linkIdentity: async (
      input: NewIdentityInput,
      tx: DbExecutor = db,
    ): Promise<boolean> => {
      const inserted = await tx
        .insert(federatedIdentities)
        .values({
          userId: input.userId,
          provider: input.provider,
          subject: input.subject,
          email: input.email,
          linkedAt: input.at,
          createdAt: input.at,
          updatedAt: input.at,
        })
        .onConflictDoNothing()
        .returning({ id: federatedIdentities.id });

      return inserted.length > 0;
    },

    /** A sign-in through an identity that was already linked (ADR-0072 §1). */
    touchIdentityLogin: async (
      id: string,
      at: Date,
      tx: DbExecutor = db,
    ): Promise<void> => {
      await tx
        .update(federatedIdentities)
        .set({ lastLoginAt: at, updatedAt: at })
        .where(eq(federatedIdentities.id, id));
    },

    // No standalone `rolesOf` — see the note in `staff.repository.ts`.
  }) as const;

export type UsersRepository = ReturnType<typeof createUsersRepository>;
