import { staff, staffRoles, type DbExecutor } from "@repo/db";
import type { ListQuery, StaffRole, StaffStatus } from "@repo/contracts";
import { and, count, eq, notInArray } from "drizzle-orm";

import { internal } from "../../core/errors/index.js";
import {
  applyListQuery,
  toSearchCondition,
  type ColumnMap,
  type ListResult,
} from "../../core/http/index.js";

/**
 * Every query against `staff` and `staff_roles` (ADR-0009).
 *
 * Every function takes an optional `tx` so a service can compose several
 * repositories inside one transaction (ADR-0006); outside one it is the client
 * itself.
 */

/**
 * A staff row plus its roles — the whole aggregate, read once.
 *
 * `passwordHash` is present here and nowhere above this layer: the mapper
 * (ADR-0012) produces the resource, and it simply has no field for the digest
 * to land in, so no endpoint can leak it by forgetting to strip it. That is
 * also why authentication and the admin endpoints share one record type rather
 * than reading the same row through two shapes — what they differ over is
 * three timestamps on a row that is being fetched either way.
 */
export interface StaffRecord {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly status: StaffStatus;
  readonly roles: readonly StaffRole[];
  readonly lastLoginAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** `POST /api/v1/admin/staff` — an admin creates the account (ADR-0018). */
export interface NewStaffInput {
  readonly email: string;
  readonly passwordHash: string;
  readonly firstName: string;
  readonly lastName: string;
}

/**
 * `PATCH /api/v1/admin/staff/:id`, column side. Roles live in the join table
 * and are written by {@link StaffRepository.replaceRoles}.
 *
 * Every field is optional and `undefined` means "leave it"; the columns are
 * `not null`, so unlike `users` there is no "clear it" case to distinguish.
 */
export interface StaffColumnPatch {
  readonly firstName?: string | undefined;
  readonly lastName?: string | undefined;
  readonly status?: StaffStatus | undefined;
}

/** Columns of `staff` every read selects. */
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
} as const;

const withRoles = { roles: { columns: { role: true } } } as const;

type StaffRowWithRoles = {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly status: StaffStatus;
  readonly lastLoginAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly roles: readonly { readonly role: StaffRole }[];
};

const toRecord = (row: StaffRowWithRoles): StaffRecord => ({
  id: row.id,
  email: row.email,
  passwordHash: row.passwordHash,
  firstName: row.firstName,
  lastName: row.lastName,
  status: row.status,
  lastLoginAt: row.lastLoginAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  roles: row.roles.map((grant) => grant.role),
});

/**
 * The API field names of `listStaffQuery` mapped to their columns (ADR-0014).
 *
 * It must cover every entry of that schema's `sortable` and `filterable`
 * lists: a field the schema admits but this map omits throws when the request
 * is built, because the allow-list already rejected anything outside it and a
 * disagreement between the two is a wiring bug, not client input.
 */
const listColumns: ColumnMap = {
  createdAt: staff.createdAt,
  updatedAt: staff.updatedAt,
  email: staff.email,
  firstName: staff.firstName,
  lastName: staff.lastName,
  status: staff.status,
  lastLoginAt: staff.lastLoginAt,
};

/** What `q` searches. Roles are not here: they are rows in another table. */
const searchColumns = [staff.email, staff.firstName, staff.lastName];

export const createStaffRepository = (db: DbExecutor) =>
  ({
    /**
     * By email, case-insensitively — `email` is `citext` (ADR-0017), so no
     * `lower()` is needed and the unique index still serves the lookup.
     */
    findByEmail: async (
      email: string,
      tx: DbExecutor = db,
    ): Promise<StaffRecord | undefined> => {
      const row = await tx.query.staff.findFirst({
        columns: recordColumns,
        with: withRoles,
        where: eq(staff.email, email),
      });

      return row === undefined ? undefined : toRecord(row);
    },

    /** By id — `GET /auth/me` and `GET /api/v1/admin/staff/:id`. */
    findById: async (
      id: string,
      tx: DbExecutor = db,
    ): Promise<StaffRecord | undefined> => {
      const row = await tx.query.staff.findFirst({
        columns: recordColumns,
        with: withRoles,
        where: eq(staff.id, id),
      });

      return row === undefined ? undefined : toRecord(row);
    },

    /**
     * `GET /api/v1/admin/staff` (ADR-0014).
     *
     * Two queries rather than one: the rows come through the relational API,
     * which is what loads each account's roles in the same round trip, and the
     * total needs the same `where` without `limit`/`offset`. Both run on the
     * executor it is given, so a caller that needs them to agree exactly hands
     * in a transaction.
     */
    list: async (
      query: ListQuery,
      tx: DbExecutor = db,
    ): Promise<ListResult<StaffRecord>> => {
      const plan = applyListQuery(query, {
        columns: listColumns,
        tiebreaker: staff.id,
        extraWhere: [toSearchCondition(searchColumns, query.q)],
      });

      const rows = await tx.query.staff.findMany({
        columns: recordColumns,
        with: withRoles,
        where: plan.where,
        orderBy: [...plan.orderBy],
        limit: plan.limit,
        offset: plan.offset,
      });

      const [counted] = await tx
        .select({ total: count() })
        .from(staff)
        .where(plan.where);

      return { rows: rows.map(toRecord), total: counted?.total ?? 0 };
    },

    /**
     * Inserts the account, or resolves to `undefined` when the email is taken.
     *
     * `onConflictDoNothing` rather than a prior `select`: two concurrent
     * creates of the same address would both find nothing and both insert, and
     * the second would surface as an unhandled unique violation.
     *
     * The returned record carries no roles — the caller grants them next, in
     * the same transaction.
     */
    create: async (
      input: NewStaffInput,
      tx: DbExecutor = db,
    ): Promise<StaffRecord | undefined> => {
      const [created] = await tx
        .insert(staff)
        .values({
          email: input.email,
          passwordHash: input.passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          // An admin-created account is usable immediately: the initial
          // password is handed over out of band (ADR-0018 §Staff onboarding).
          // `invited` waits for the invitation-email feature.
          status: "active",
        })
        .onConflictDoNothing({ target: staff.email })
        .returning({
          id: staff.id,
          email: staff.email,
          passwordHash: staff.passwordHash,
          firstName: staff.firstName,
          lastName: staff.lastName,
          status: staff.status,
          lastLoginAt: staff.lastLoginAt,
          createdAt: staff.createdAt,
          updatedAt: staff.updatedAt,
        });

      if (created === undefined) return undefined;

      return { ...created, roles: [] };
    },

    /**
     * Writes the column half of a patch.
     *
     * `updatedAt` is set here, not by a trigger (ADR-0006), and the caller
     * passes the same instant to every write of one edit so the row carries a
     * single timestamp for it.
     *
     * @returns `false` when no row has that id.
     */
    updateColumns: async (
      id: string,
      patch: StaffColumnPatch,
      at: Date,
      tx: DbExecutor = db,
    ): Promise<boolean> => {
      const updated = await tx
        .update(staff)
        .set({
          ...(patch.firstName === undefined
            ? {}
            : { firstName: patch.firstName }),
          ...(patch.lastName === undefined ? {} : { lastName: patch.lastName }),
          ...(patch.status === undefined ? {} : { status: patch.status }),
          updatedAt: at,
        })
        .where(eq(staff.id, id))
        .returning({ id: staff.id });

      return updated.length > 0;
    },

    /**
     * Makes `roles` the account's exact set of grants.
     *
     * A delete of what is no longer held plus an idempotent insert of what is,
     * rather than "delete all, insert all": the latter would rewrite
     * `granted_at` and `granted_by` on every role that did not change, and
     * those two columns exist to answer "who gave this person admin, and
     * when?" (ADR-0017).
     */
    replaceRoles: async (
      staffId: string,
      roles: readonly StaffRole[],
      grantedBy: string | null,
      tx: DbExecutor = db,
    ): Promise<void> => {
      if (roles.length === 0) {
        // Unreachable through the API — `staffRolesSchema` requires at least
        // one role — and refused here rather than silently revoking every
        // grant, because `notInArray(column, [])` is not a no-op in SQL.
        throw internal(new Error("staff.replaceRoles was given no roles"));
      }

      await tx
        .delete(staffRoles)
        .where(
          and(
            eq(staffRoles.staffId, staffId),
            notInArray(staffRoles.role, [...roles]),
          ),
        );

      await tx
        .insert(staffRoles)
        .values(roles.map((role) => ({ staffId, role, grantedBy })))
        .onConflictDoNothing();
    },

    /**
     * How many accounts *other than* `id` are an active `super_admin`.
     *
     * The ADR-0017 invariant is "at least one super admin must exist", and the
     * only way to check it while editing one account is to count the rest.
     * Excluding `id` here rather than counting everybody means the caller does
     * not have to reason about whether the row it is changing is included.
     */
    countOtherActiveSuperAdmins: async (
      id: string,
      tx: DbExecutor = db,
    ): Promise<number> => {
      const [counted] = await tx
        .select({ total: count() })
        .from(staff)
        .innerJoin(staffRoles, eq(staffRoles.staffId, staff.id))
        .where(
          and(
            eq(staffRoles.role, "super_admin"),
            eq(staff.status, "active"),
            notInArray(staff.id, [id]),
          ),
        );

      return counted?.total ?? 0;
    },

    /** ADR-0018 login step 5. */
    updateLastLoginAt: async (
      id: string,
      at: Date,
      tx: DbExecutor = db,
    ): Promise<void> => {
      await tx
        .update(staff)
        .set({ lastLoginAt: at, updatedAt: at })
        .where(eq(staff.id, id));
    },

    /** Transparent argon2 parameter upgrade after a successful login (ADR-0018). */
    updatePasswordHash: async (
      id: string,
      passwordHash: string,
      at: Date,
      tx: DbExecutor = db,
    ): Promise<void> => {
      await tx
        .update(staff)
        .set({ passwordHash, updatedAt: at })
        .where(eq(staff.id, id));
    },

    // No standalone `rolesOf`: every read above returns the grants from the
    // same query, and a separate one would be a second round trip on the login
    // path (ADR-0017, amended step 8).
  }) as const;

export type StaffRepository = ReturnType<typeof createStaffRepository>;
