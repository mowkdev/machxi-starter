/**
 * The eighth platform package: the account's client (`D22.2`,
 * [ADR-0077](../../../docs/adr/0077-shared-composition-second-wave.md) §2).
 *
 * Both SPAs repeated it file for file — the settings entity with its
 * coalescing writer, the settings gate, the three preference cards, password
 * recovery, and the two profile forms both segments have — and those are the
 * files a fork edits first. Read side by side, each difference was a value:
 * whether a grid preference adapter is mounted, which contract a profile form
 * validates with, three sentences an operator and a customer are told
 * differently, and where a router sends a person next.
 *
 * **It is the first package that names a resource, and it names the account's
 * own** — settings, profile, credentials — and no other. What one segment
 * alone has stays in that app: email change, account deletion, sign-in
 * methods, staff invalidation.
 *
 * **It depends downward only, on `@repo/app-kit` never and on `@repo/grid`
 * never.** What it needs from either arrives as a parameter: the kit's
 * principal-cache boundary and its options control as slots, the grid's
 * preference seam as three functions and a provider. Navigation leaves as
 * callbacks and rendered children, because a router types its destinations
 * against the app's own route tree.
 *
 * **An app reaches it through the feature and entity slices that held the
 * code** (§3), which re-export and bind the app's values — a page's imports
 * do not change.
 */

export { ACCOUNT_NAMESPACE, bundles, loadCatalogue, register } from "./i18n";

export { createSettingsApi, type SettingsApi } from "./settings/settings.api";
export { settingsKeys } from "./settings/settings.keys";
export { useSettings, useUpdateSettings } from "./settings/settings.queries";
export {
  SETTINGS_WRITE_DEBOUNCE_MS,
  createServerPreferenceAdapter,
  createSettingsWriter,
  type GridPreferenceSeam,
  type PreferenceStorage,
  type SettingsFlush,
  type SettingsWriter,
  type SettingsWriterDeps,
} from "./settings/settings.storage";
export {
  createSettingsProvider,
  type SettingsProviderDeps,
  type SettingsProviderProps,
} from "./settings/settings-provider";
export type {
  AccountSettings,
  AccountSettingsPatch,
} from "./settings/settings.types";

export { createGridDensityCards } from "./preferences/density-cards";
export { createLocaleRows } from "./preferences/locale-rows";
export { createThemeCards } from "./preferences/theme-cards";
export type {
  PreferenceOption,
  PreferenceOptionsControl,
  PreferenceOptionsProps,
} from "./preferences/options-control";

export {
  createPasswordRecovery,
  type PasswordRecoveryDeps,
  type PasswordReset,
  type PasswordResetStatus,
  type RecoveryNavigation,
} from "./password-reset";

export {
  createChangePasswordDialog,
  createChangePasswordFields,
  type ChangePasswordCopy,
  type ChangePasswordDeps,
} from "./profile/change-password-dialog";
export {
  createProfileDetailsForm,
  type ProfileDetailsDeps,
  type ProfileNames,
} from "./profile/profile-details-form";
