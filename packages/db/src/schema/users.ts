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
    /** Unique **within users**; a staff member with the same address is a different account. */
    email: citext().notNull().unique(),
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
    // Default `-createdAt` order and `createdAt` range filters of
    // GET /api/v1/admin/users (ADR-0014).
    index("users_created_at_idx").on(table.createdAt),
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
