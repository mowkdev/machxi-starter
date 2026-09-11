/**
 * The schema namespace (ADR-0006): every table, enum and relation in one
 * object, which is what `drizzle-kit generate` diffs and what `createDb`
 * passes to Drizzle for the relational query API.
 *
 * One file per aggregate; `relations()` sits next to the tables it joins.
 */
export {
  auditActorTypeEnum,
  citext,
  federatedProviderEnum,
  gridDensityEnum,
  localeEnum,
  organizationKindEnum,
  organizationRoleEnum,
  primaryId,
  principalTypeEnum,
  staffRoleEnum,
  staffStatusEnum,
  themeEnum,
  timestamps,
  tokenPurposeEnum,
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
export {
  organizationInvitations,
  organizationInvitationsRelations,
  organizationMemberships,
  organizationMembershipsRelations,
  organizations,
  organizationsRelations,
} from "./organizations.js";
export { sessions } from "./sessions.js";
export { accountTokens } from "./account-tokens.js";
export {
  federatedIdentities,
  federatedIdentitiesRelations,
} from "./federated-identities.js";
export { impersonationHandoffs } from "./impersonation.js";
export { auditEvents } from "./audit.js";
export {
  staffSettings,
  staffSettingsRelations,
  userSettings,
  userSettingsRelations,
} from "./settings.js";
