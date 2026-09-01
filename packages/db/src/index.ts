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
  type CreateDbOptions,
  type Db,
  type DbClient,
  type DbExecutor,
  type Transaction,
} from "./client.js";

export * as schema from "./schema/index.js";

export {
  auditEvents,
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
  principalTypeEnum,
  staffRoleEnum,
  staffStatusEnum,
  themeEnum,
  userRoleEnum,
  userStatusEnum,
} from "./schema/index.js";

export type {
  AuditEvent,
  NewAuditEvent,
  NewSession,
  NewStaff,
  NewStaffRoleGrant,
  NewStaffSettings,
  NewUser,
  NewUserRoleGrant,
  NewUserSettings,
  Session,
  Staff,
  StaffRoleGrant,
  StaffSettings,
  User,
  UserRoleGrant,
  UserSettings,
} from "./types.js";
