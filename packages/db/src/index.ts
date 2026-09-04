/**
 * `@repo/db` — the Postgres schema, its client and its row types (ADR-0006).
 *
 * Published as TypeScript source (ADR-0002) and consumed by the API's
 * repositories, by the migration runner and by the seeders. Depends on
 * `@repo/contracts` (the enum tuples) and `@repo/crypto` (the seeders' password
 * hasher) and on nothing else internal.
 *
 * Importing this module opens no connection and reads no environment variable:
 * `createDb` takes its URL as an argument, and the only `process.env` access in
 * the package lives in `src/tooling/env.ts`, which the CLI entry points use.
 */
export {
  createDb,
  DEFAULT_APPLICATION_NAME,
  DEFAULT_IDLE_TRANSACTION_TIMEOUT_MS,
  DEFAULT_STATEMENT_TIMEOUT_MS,
  type CreateDbOptions,
  type Db,
  type DbClient,
  type DbExecutor,
  type Transaction,
} from "./client.js";

export * as schema from "./schema/index.js";

export {
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

export {
  auditActorTypeEnum,
  localeEnum,
  organizationKindEnum,
  organizationRoleEnum,
  principalTypeEnum,
  staffRoleEnum,
  staffStatusEnum,
  themeEnum,
  userRoleEnum,
  userStatusEnum,
} from "./schema/index.js";

/**
 * The personal organization's derived name and slug (ADR-0067 §2), shared by
 * the seeders and by the API's organizations service so the two cannot drift.
 */
export {
  personalOrganizationName,
  personalOrganizationSlug,
  type PersonalOrganizationOwner,
} from "./organizations.js";

export type {
  AuditEvent,
  ImpersonationHandoff,
  NewAuditEvent,
  NewImpersonationHandoff,
  NewOrganization,
  NewOrganizationInvitation,
  NewOrganizationMembership,
  NewSession,
  NewStaff,
  NewStaffRoleGrant,
  NewStaffSettings,
  NewUser,
  NewUserRoleGrant,
  NewUserSettings,
  Organization,
  OrganizationInvitation,
  OrganizationMembership,
  Session,
  Staff,
  StaffRoleGrant,
  StaffSettings,
  User,
  UserRoleGrant,
  UserSettings,
} from "./types.js";
