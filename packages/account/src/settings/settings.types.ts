import type {
  StaffSettingsResource,
  UpdateStaffSettingsBody,
  UpdateUserSettingsBody,
  UserSettingsResource,
} from "@repo/contracts";

/**
 * The account's settings as this package reads and writes them (`D22.2`,
 * ADR-0077 §2).
 *
 * `@repo/contracts` declares the resource and the body once per population
 * and says why: "the pair is the split point". The two are one shape today,
 * so the union below is that shape under either name, and an app's callers
 * go on naming their own segment's type. The day one population's settings
 * grow a field the other has no use for, these two become parameters of the
 * client rather than a union — which is a change to this file and to no
 * consumer.
 */
export type AccountSettings = StaffSettingsResource | UserSettingsResource;

export type AccountSettingsPatch =
  UpdateStaffSettingsBody | UpdateUserSettingsBody;
