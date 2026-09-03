import {
  useGridPreferences as useGridPreferencesFor,
  type GridPreferences,
  type GridPreferencesStore,
  type PreferenceStorage,
} from "@repo/grid";

import { DEVICE_KEY_PREFIX } from "@/shared/config";

/**
 * The door onto the grid's preference hooks (`D9.4`, ADR-0051).
 *
 * **The device-key prefix is bound here** (`D14.7`, ADR-0064 §1), for the
 * reason the sibling doors bind theirs: `@repo/grid` takes
 * `${appId}.${segment}` as a parameter because it may hold neither a brand nor
 * an app name, and no consumer above this file should have to know that.
 */
export { PreferenceStorageProvider } from "@repo/grid";

export const useGridPreferences = ({
  gridId,
  movable,
  storage,
}: {
  readonly gridId: string | undefined;
  readonly movable: readonly string[];
  readonly storage: PreferenceStorage | undefined;
}): readonly [GridPreferences, GridPreferencesStore] =>
  useGridPreferencesFor({
    gridId,
    keyPrefix: DEVICE_KEY_PREFIX,
    movable,
    storage,
  });
