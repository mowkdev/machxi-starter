import type { InferInsertModel, InferSelectModel } from "drizzle-orm";

import type {
  auditEvents,
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
 * An audit row (ADR-0058).
 *
 * The pair is declared for the same reason as every other one here, but the
 * table is written through exactly one shape — `AuditEventRow` in
 * `apps/api/src/core/audit`, which is `New` with nothing optional and every
 * absent column spelled `null`, because a row whose actor was merely forgotten
 * is worse than no row at all.
 */
export type AuditEvent = InferSelectModel<typeof auditEvents>;
export type NewAuditEvent = InferInsertModel<typeof auditEvents>;

/**
 * The settings pair (ADR-0045). Two row types for what is one shape today,
 * because the tables are the split point: the day a customer setting arrives
 * that staff have no use for, one of these grows and the other does not.
 */
export type StaffSettings = InferSelectModel<typeof staffSettings>;
export type NewStaffSettings = InferInsertModel<typeof staffSettings>;

export type UserSettings = InferSelectModel<typeof userSettings>;
export type NewUserSettings = InferInsertModel<typeof userSettings>;
