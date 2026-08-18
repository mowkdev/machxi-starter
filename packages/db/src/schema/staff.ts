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
    // Serves the default `-createdAt` order of GET /api/v1/admin/staff
    // (ADR-0014) and its `createdAt` range filters.
    index("staff_created_at_idx").on(table.createdAt),
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

export const staffRelations = relations(staff, ({ many }) => ({
  roles: many(staffRoles),
}));

export const staffRolesRelations = relations(staffRoles, ({ one }) => ({
  staff: one(staff, {
    fields: [staffRoles.staffId],
    references: [staff.id],
  }),
  grantedByStaff: one(staff, {
    fields: [staffRoles.grantedBy],
    references: [staff.id],
  }),
}));
