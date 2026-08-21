/**
 * The schema namespace (ADR-0006): every table, enum and relation in one
 * object, which is what `drizzle-kit generate` diffs and what `createDb`
 * passes to Drizzle for the relational query API.
 *
 * One file per aggregate; `relations()` sits next to the tables it joins.
 */
export {
  citext,
  localeEnum,
  primaryId,
  principalTypeEnum,
  staffRoleEnum,
  staffStatusEnum,
  themeEnum,
  timestamps,
  userRoleEnum,
  userStatusEnum,
} from "./_shared.js";
export {
  staff,
  staffRelations,
  staffRoles,
  staffRolesRelations,
} from "./staff.js";
export {
  userRoles,
  userRolesRelations,
  users,
  usersRelations,
} from "./users.js";
export { sessions } from "./sessions.js";
export {
  staffSettings,
  staffSettingsRelations,
  userSettings,
  userSettingsRelations,
} from "./settings.js";
