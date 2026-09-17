import { isNotNull, isNull, relations, sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  citext,
  primaryId,
  timestamps,
  userRoleEnum,
  userStatusEnum,
} from "./_shared.js";

/**
 * Users — external customers of the web and mobile clients (ADR-0017).
 *
 * Mirrors `staff` in shape but not in constraints, which is the point of
 * keeping them apart: names are optional, the password hash is nullable, and
 * the account is soft-deletable.
 */
export const users = pgTable(
  "users",
  {
    id: primaryId(),
    /**
     * Unique **within users**, and only among *live* rows — the constraint is
     * the partial index in the table extras below, not on this column
     * (ADR-0028).
     *
     * A staff member with the same address is a different account.
     */
    email: citext().notNull(),
    /**
     * Nullable, unlike `staff.password_hash`: the social / passwordless paths
     * in ADR-0018's future scope create an account with no password at all.
     * The auth service treats `null` as "no password login for this account",
     * never as "any password matches".
     */
    passwordHash: text(),
    firstName: text(),
    lastName: text(),
    status: userStatusEnum().notNull().default("active"),
    /**
     * When the address on this row was proven (ADR-0071 §3).
     *
     * `null` means it never was. Set by the verification link, and set the
     * same way by a staff member who **asserts** the address — creating the
     * account through `POST /admin/users` or setting it under §7 — because the
     * operator is the authority a link would be asking.
     *
     * The invariant it is *for* is what everything downstream will lean on:
     * **every `active` user has a proven address**, so address-match
     * acceptance of an invitation (ADR-0067 §5) needs no extra rule and a
     * federated identity (D19) may link by reading `status` alone. Nothing
     * re-checks this column as a flag — it is the record of the fact, not the
     * gate.
     *
     * **It did not hold before `D18.3`** (`D18.1`'s `security-reviewer`): the
     * column and its backfill arrived at `D18.1` and the paths that keep it
     * true at `D18.3`, when registration started creating
     * `pending_verification` and the two staff paths that assert an address
     * started stamping. Between the two, every account created was `active`
     * with a null stamp, and reading the invariant as already true is exactly
     * how an unenforced claim becomes an account-takeover primitive — which
     * is why the sentence carried its date.
     *
     * **Since `D20.5` the database holds it** rather than the three paths
     * remembering: `users_active_email_verified_check` below (ADR-0073 §8).
     *
     * Deliberately not `not null` with a default: the whole point is that a
     * `pending_verification` row has nothing here.
     */
    emailVerifiedAt: timestamp({ withTimezone: true }),
    /** `null` until the account signs in for the first time. */
    lastLoginAt: timestamp({ withTimezone: true }),
    ...timestamps(),
    /**
     * Soft delete (ADR-0006). Only `users` has it: a customer record is
     * referenced by future order history, while a staff member is a directory
     * entry that can be removed outright.
     */
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    /**
     * One **live** account per address (ADR-0028).
     *
     * Partial rather than a plain unique constraint, so deleting an account
     * releases its address: without the `where`, a soft-deleted row keeps the
     * address reserved forever and "I deleted my account and want to come
     * back" has no answer. Two rows may therefore share an address with at
     * most one of them live, which every existing read already tolerates —
     * `findByEmail` filters `deleted_at is null` and is the only lookup
     * authentication uses.
     *
     * It is also the target `usersRepository.create` must name in
     * `onConflictDoNothing`: an insert that names the old constraint matches
     * no index, so the unique violation escapes as a `500` instead of the
     * `CONFLICT` the caller is owed.
     */
    uniqueIndex("users_email_active_unique")
      .on(table.email)
      .where(isNull(table.deletedAt)),
    /**
     * **Every `active` user has a proven address** — the invariant of
     * {@link users.emailVerifiedAt}, held by the database since `D20.5`
     * (ADR-0073 §8, closing the review's `DB-04`).
     *
     * It was a code-only rule from `D18.3`: registration creates
     * `pending_verification`, the two staff paths that assert an address
     * stamp it, and the activation update `coalesce`s a stamp in. Three paths
     * that each remember, and everything downstream leaning on the result —
     * invitation acceptance by address (ADR-0067 §5) and federated linking by
     * `status` alone (ADR-0072 §1) both read the invariant rather than the
     * column. A fourth path that forgot would not fail; it would quietly hand
     * somebody else's mailbox an account.
     *
     * Written as `status <> 'active' OR …` rather than as an implication
     * because SQL has no implication operator; it is the same statement. Note
     * what it deliberately does **not** say: a `disabled` or a
     * `pending_verification` row may carry a stamp or not — `disabled` is a
     * decision about the account and not about the mailbox — and a
     * soft-deleted row is bound by its `status` like any other, because
     * `deleted_at` does not clear it.
     *
     * `CHECK` and not a trigger: it is a row-local predicate, Postgres
     * enforces it on every write including a raw one, and it appears in the
     * table definition where the next person reads the column.
     */
    check(
      "users_active_email_verified_check",
      sql`${table.status} <> 'active' or ${table.emailVerifiedAt} is not null`,
    ),
    /*
     * One btree index per sortable column, composite with `id`
     * (ADR-0060 §3).
     *
     * `id` is the second column because it is the second column of the sort:
     * `applyListQuery` appends `asc(id)` to every `ORDER BY` as the
     * determinism tiebreaker (ADR-0014 §Determinism), so `(column, id)` is
     * the pagination key itself rather than a prefix of it. A filter on the
     * leading column — `createdAt` ranges, a `status` equality — is served by
     * the same index.
     *
     * The rule they exist for is checked, not remembered:
     * `users.list-indexes.test.ts` in `apps/api` diffs this list against the
     * endpoint's `sortable`, `filterable` and searched allow-lists, and fails
     * when a column claims an order nothing serves.
     */
    index("users_created_at_idx").on(table.createdAt, table.id),
    index("users_updated_at_idx").on(table.updatedAt, table.id),
    /*
     * Unlike `staff.email`, which is unique across the whole table and
     * therefore already indexed, this address is unique only among **live**
     * rows: `users_email_active_unique` above is partial, so it cannot serve
     * an order over a list that includes deleted accounts — which is exactly
     * what `filter[deletedAt][null]=false` asks for.
     */
    index("users_email_idx").on(table.email, table.id),
    index("users_first_name_idx").on(table.firstName, table.id),
    index("users_last_name_idx").on(table.lastName, table.id),
    index("users_status_idx").on(table.status, table.id),
    index("users_last_login_at_idx").on(table.lastLoginAt, table.id),
    /*
     * `deletedAt` is filterable by presence only, and only one of the two
     * presences is worth indexing: the column is null on every live account,
     * so a full index would be a copy of the table, while the partial form
     * indexes exactly the rows "show me deleted accounts" is about.
     */
    index("users_deleted_at_idx")
      .on(table.deletedAt)
      .where(isNotNull(table.deletedAt)),
    /*
     * The `q` search (ADR-0060 §3): `ilike '%term%'` cannot use a btree index
     * at all, so each searched column gets a `pg_trgm` GIN index. The
     * extension arrives by migration `0009_pg_trgm.sql`, exactly as `citext`
     * does by `0000`.
     *
     * The operator class is named on the column itself even for `email`,
     * whose type is `citext`: `citext` is binary-coercible to `text`, so
     * Postgres accepts `gin_trgm_ops` here. What it does **not** accept is
     * `citext ILIKE`, whose operator is in no trgm family — which is why
     * `toSearchCondition` casts every searched column to `text` before
     * comparing (ADR-0060 §3, amended).
     */
    index("users_email_trgm_idx").using("gin", table.email.op("gin_trgm_ops")),
    index("users_first_name_trgm_idx").using(
      "gin",
      table.firstName.op("gin_trgm_ops"),
    ),
    index("users_last_name_trgm_idx").using(
      "gin",
      table.lastName.op("gin_trgm_ops"),
    ),
  ],
);

/** The roles a user holds (ADR-0017). v1 has exactly one value, `customer`. */
export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: userRoleEnum().notNull(),
    grantedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // No `grantedBy` counterpart to `staff_roles`: a user's role is assigned by
    // registration, not by a person, and a FK to `staff` would make `users`
    // depend on the other population.
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.role] }),
    index("user_roles_role_idx").on(table.role),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  roles: many(userRoles),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, {
    fields: [userRoles.userId],
    references: [users.id],
  }),
}));
