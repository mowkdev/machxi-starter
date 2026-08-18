import { userRoles, users, type DbExecutor } from "@repo/db";
import type { ListQuery, UserRole, UserStatus } from "@repo/contracts";
import { and, count, eq, isNull, notInArray } from "drizzle-orm";

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

/** What self-registration and `POST /api/v1/admin/users` insert. */
export interface NewUserInput {
  readonly email: string;
  readonly passwordHash: string;
  readonly firstName?: string | undefined;
  readonly lastName?: string | undefined;
  /**
   * Defaults to `active`. Self-registration leaves it alone;
   * `pending_verification` waits for the email-verification feature, and an
   * admin may set any of the three (ADR-0017).
   */
  readonly status?: UserStatus | undefined;
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

/** The API field names of `listUsersQuery` mapped to their columns (ADR-0014). */
const listColumns: ColumnMap = {
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
  email: users.email,
  firstName: users.firstName,
  lastName: users.lastName,
  status: users.status,
  lastLoginAt: users.lastLoginAt,
  deletedAt: users.deletedAt,
};

const searchColumns = [users.email, users.firstName, users.lastName];

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
        })
        .onConflictDoNothing({ target: users.email })
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
     * @returns `false` when no row has that id.
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
          updatedAt: at,
        })
        .where(eq(users.id, id))
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

    updatePasswordHash: async (
      id: string,
      passwordHash: string,
      at: Date,
      tx: DbExecutor = db,
    ): Promise<void> => {
      await tx
        .update(users)
        .set({ passwordHash, updatedAt: at })
        .where(eq(users.id, id));
    },

    // No standalone `rolesOf` — see the note in `staff.repository.ts`.
  }) as const;

export type UsersRepository = ReturnType<typeof createUsersRepository>;
