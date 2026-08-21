import type { InferInsertModel, InferSelectModel } from "drizzle-orm";

import type {
  sessions,
  staff,
  staffRoles,
  staffSettings,
  userRoles,
  userSettings,
  users,
} from "./schema/index.js";

/**
 * Row types (ADR-0006).
 *
 * `Select` is what a query returns, `Insert` is what a write accepts — they
 * differ wherever a column has a default (`id`, the timestamps, `status`), and
 * conflating the two is how "id is required on insert" errors appear.
 *
 * These are **storage** types. What the API puts on the wire is the resource
 * types in `@repo/contracts` (ADR-0023); the module mappers convert between
 * them, which is what lets `passwordHash` exist here and nowhere else.
 */

export type Staff = InferSelectModel<typeof staff>;
export type NewStaff = InferInsertModel<typeof staff>;

export type StaffRoleGrant = InferSelectModel<typeof staffRoles>;
export type NewStaffRoleGrant = InferInsertModel<typeof staffRoles>;

export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;

export type UserRoleGrant = InferSelectModel<typeof userRoles>;
export type NewUserRoleGrant = InferInsertModel<typeof userRoles>;

export type Session = InferSelectModel<typeof sessions>;
export type NewSession = InferInsertModel<typeof sessions>;

/**
 * The settings pair (ADR-0045). Two row types for what is one shape today,
 * because the tables are the split point: the day a customer setting arrives
 * that staff have no use for, one of these grows and the other does not.
 */
export type StaffSettings = InferSelectModel<typeof staffSettings>;
export type NewStaffSettings = InferInsertModel<typeof staffSettings>;

export type UserSettings = InferSelectModel<typeof userSettings>;
export type NewUserSettings = InferInsertModel<typeof userSettings>;
