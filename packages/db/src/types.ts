import type { InferInsertModel, InferSelectModel } from "drizzle-orm";

import type {
  auditEvents,
  impersonationHandoffs,
  organizationInvitations,
  organizationMemberships,
  organizations,
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
 * A one-time impersonation handoff (ADR-0057 §2). Short-lived, consumed once,
 * and never joined to a live account — see the table's own note.
 */
export type ImpersonationHandoff = InferSelectModel<
  typeof impersonationHandoffs
>;
export type NewImpersonationHandoff = InferInsertModel<
  typeof impersonationHandoffs
>;

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

/**
 * The tenant and what it owns (ADR-0067 §2).
 *
 * `OrganizationInvitation` has no `status`: the row's state is read from its
 * timestamps, and `expired` is the one state no column can hold. The wire form
 * is `INVITATION_STATUSES` in `@repo/contracts`, which the mapper derives.
 *
 * It does carry a `tokenHash`, and that one is **never mapped onto the wire**:
 * it is the stored form of a credential (ADR-0067 §2, amended 2026-09-04), so
 * the mapper drops it exactly as the auth mapper drops
 * `sessions.refreshTokenHash`. Nothing in D15 reads it at all.
 */
export type Organization = InferSelectModel<typeof organizations>;
export type NewOrganization = InferInsertModel<typeof organizations>;

export type OrganizationMembership = InferSelectModel<
  typeof organizationMemberships
>;
export type NewOrganizationMembership = InferInsertModel<
  typeof organizationMemberships
>;

export type OrganizationInvitation = InferSelectModel<
  typeof organizationInvitations
>;
export type NewOrganizationInvitation = InferInsertModel<
  typeof organizationInvitations
>;
