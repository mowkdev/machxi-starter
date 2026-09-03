/**
 * The door onto the grid's column preferences (`D9.4`, ADR-0051).
 *
 * **The key prefix is bound here** (`D14.7`, ADR-0064 §1): `@repo/grid` takes
 * `${appId}.${segment}` as a parameter because it may hold neither a brand nor
 * an app name, and this app still writes `machxi.admin.grid:<gridId>:v1`.
 * Binding it at the door leaves `entities/settings` and both grid suites
 * writing the call they already wrote.
 */
import {
  createGridPreferences as createGridPreferencesFor,
  gridStorageKey as gridStorageKeyFor,
  parseGridStorageKey as parseGridStorageKeyFor,
  type GridPreferenceDefaults,
  type GridPreferencesStore,
  type PreferenceStorage,
} from "@repo/grid";

import { DEVICE_KEY_PREFIX } from "@/shared/config";

export {
  clampColumnWidth,
  createLocalStorageAdapter,
  createMemoryStorage,
  reconcile,
  type GridPreferenceDefaults,
  type GridPreferences,
  type GridPreferencesStore,
  type PreferenceStorage,
} from "@repo/grid";

export const gridStorageKey = (gridId: string): string =>
  gridStorageKeyFor(DEVICE_KEY_PREFIX, gridId);

export const parseGridStorageKey = (key: string): string | null =>
  parseGridStorageKeyFor(DEVICE_KEY_PREFIX, key);

export const createGridPreferences = (options: {
  readonly gridId: string;
  readonly storage: PreferenceStorage;
  readonly defaults: GridPreferenceDefaults;
}): GridPreferencesStore =>
  createGridPreferencesFor({ ...options, keyPrefix: DEVICE_KEY_PREFIX });
