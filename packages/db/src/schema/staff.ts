import { relations } from "drizzle-orm";
import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import {
  citext,
  primaryId,
  staffRoleEnum,
  staffStatusEnum,
  timestamps,
} from "./_shared.js";

/**
 * Staff — internal operators of the admin panel (ADR-0017).
 *
 * A separate aggregate from `users`, not a row type inside a shared
 * `accounts` table: the two populations authenticate separately, are served by
 * separate route segments (ADR-0015) and are free to grow attributes without
 * adding nullable columns to each other.
 */
export const staff = pgTable(
  "staff",
  {
    id: primaryId(),
    /** Case-insensitive and unique **within staff** — the same person may also be a user. */
    email: citext().notNull().unique(),
    /**
     * argon2id PHC string (ADR-0018). `not null`, unlike `users.password_hash`:
     * staff have no passwordless path — they are created by an admin with an
     * initial password.
     */
    passwordHash: text().notNull(),
    firstName: text().notNull(),
    lastName: text().notNull(),
    status: staffStatusEnum().notNull().default("active"),
    /** `null` until the account signs in for the first time. */
    lastLoginAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    /*
     * One btree index per sortable column, composite with `id`
     * (ADR-0060 §3) — `applyListQuery` appends `asc(id)` to every `ORDER BY`,
     * so `(column, id)` is the pagination key rather than a prefix of it, and
     * a filter on the leading column is served by the same index.
     *
     * **`email` is absent on purpose**: it is `unique` across the whole table
     * (no partial predicate, unlike `users.email`), so Postgres has already
     * built a btree index on it and a second one would be write cost for
     * nothing. `staff.list-indexes.test.ts` reads unique constraints as index
     * declarations for exactly this reason.
     */
    index("staff_created_at_idx").on(table.createdAt, table.id),
    index("staff_updated_at_idx").on(table.updatedAt, table.id),
    index("staff_first_name_idx").on(table.firstName, table.id),
    index("staff_last_name_idx").on(table.lastName, table.id),
    index("staff_status_idx").on(table.status, table.id),
    index("staff_last_login_at_idx").on(table.lastLoginAt, table.id),
    /*
     * The `q` search (ADR-0060 §3), mirroring `users`: `ilike '%term%'` reads
     * no btree index, so each searched column gets a `pg_trgm` GIN one. See
     * the note on `users.email` for why the operator class is named on a
     * `citext` column and why the query casts to `text`.
     */
    index("staff_email_trgm_idx").using("gin", table.email.op("gin_trgm_ops")),
    index("staff_first_name_trgm_idx").using(
      "gin",
      table.firstName.op("gin_trgm_ops"),
    ),
    index("staff_last_name_trgm_idx").using(
      "gin",
      table.lastName.op("gin_trgm_ops"),
    ),
  ],
);

/**
 * The roles a staff member holds (ADR-0017). A join table rather than a column
 * because an account may hold several; the composite primary key is what makes
 * "grant a role twice" a no-op instead of a duplicate row.
 */
export const staffRoles = pgTable(
  "staff_roles",
  {
    staffId: uuid()
      .notNull()
      // Deleting a staff member takes their grants with them; the row has no
      // meaning without the account.
      .references(() => staff.id, { onDelete: "cascade" }),
    role: staffRoleEnum().notNull(),
    grantedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /**
     * Who granted it — audit only, and `null` for the seeded super admin,
     * which nobody granted. `set null` rather than `cascade`: deleting the
     * granter must not delete the grant.
     */
    grantedBy: uuid().references(() => staff.id, { onDelete: "set null" }),
  },
  (table) => [
    primaryKey({ columns: [table.staffId, table.role] }),
    // "Who are the admins?" — the reverse of the PK's leading column.
    index("staff_roles_role_idx").on(table.role),
  ],
);

/**
 * `staff_roles` points at `staff` **twice** — once as the holder of the grant
 * and once as whoever issued it — so both relations must be named.
 *
 * Without `relationName`, `db.query.staff.findFirst({ with: { roles: true } })`
 * fails at query-build time with "there are multiple relations between
 * staffRoles and staff": Drizzle cannot tell which of the two foreign keys the
 * `many` side means. Nothing about the SQL changes, so this is not a
 * migration — `relations()` is a TypeScript-level description of joins the
 * relational query API may take.
 */
const ROLE_HOLDER = "staffRoleHolder";
const ROLE_GRANTER = "staffRoleGranter";

export const staffRelations = relations(staff, ({ many }) => ({
  roles: many(staffRoles, { relationName: ROLE_HOLDER }),
  /** Grants this staff member issued to others — the audit direction. */
  grantedRoles: many(staffRoles, { relationName: ROLE_GRANTER }),
}));

export const staffRolesRelations = relations(staffRoles, ({ one }) => ({
  staff: one(staff, {
    fields: [staffRoles.staffId],
    references: [staff.id],
    relationName: ROLE_HOLDER,
  }),
  grantedByStaff: one(staff, {
    fields: [staffRoles.grantedBy],
    references: [staff.id],
    relationName: ROLE_GRANTER,
  }),
}));
