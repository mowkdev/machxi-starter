import { useMemo, useSyncExternalStore } from "react";

import {
  createGridPreferences,
  createLocalStorageAdapter,
  createMemoryStorage,
  type GridPreferences,
  type GridPreferencesStore,
  type PreferenceStorage,
} from "./preferences";

/**
 * The store, bound to React (ADR-0041).
 *
 * `useSyncExternalStore`, so nothing in `preferences.ts` knows React exists —
 * the same shape ADR-0033's session store established, and the reason the
 * future server-backed adapter changes one file rather than a component tree.
 */

/**
 * The memo dependency, and the reason it is a string.
 *
 * `movable` is derived from the merged column config, so it is a fresh array
 * every render; memoising the store on the array itself would rebuild it,
 * re-read storage and re-reconcile on every render. The **ids** are what the
 * store depends on, and a joined string of them is something React can compare.
 *
 * It is used as the dependency and *nothing else*. An earlier version split it
 * back to rebuild the array, which made "no config key contains a newline" an
 * invariant nothing enforced — a key that did would have split into two phantom
 * ids and become the store's whole allow-list. The array itself is passed
 * through; only the comparison goes through the string.
 */
const SEPARATOR = "\n";

/**
 * A grid with **no `gridId` persists nothing**, and that is the honest default
 * rather than a disabled feature.
 *
 * Sizing, ordering and hiding all still work for the life of the component;
 * they simply have nowhere to be written. The alternative — persisting under a
 * shared fallback key — is worse than not persisting: two unrelated grids would
 * fight over one entry and each would restore the other's layout.
 */
export const useGridPreferences = ({
  gridId,
  movable,
  storage,
}: {
  readonly gridId: string | undefined;
  /** The movable column ids, in config declaration order. */
  readonly movable: readonly string[];
  /** The adapter seam, exposed so a caller can supply another implementation. */
  readonly storage: PreferenceStorage | undefined;
}): readonly [GridPreferences, GridPreferencesStore] => {
  const movableKey = movable.join(SEPARATOR);

  const store = useMemo(
    () =>
      createGridPreferences({
        /*
         * The unnamed case gets a private in-memory adapter below, so this
         * placeholder key is reachable only by the one component that made it
         * and cannot collide with another grid's.
         */
        gridId: gridId ?? "unnamed",
        /*
         * No id, no persistence — unconditionally, and the supplied adapter is
         * ignored rather than pointed at the placeholder key. A caller that
         * passed a storage but forgot the id would otherwise write every
         * unnamed grid in the app into one entry, which is the collision
         * `gridId` exists to prevent arriving through the seam that was meant
         * to make it configurable.
         */
        storage:
          gridId === undefined
            ? createMemoryStorage()
            : (storage ?? createLocalStorageAdapter()),
        defaults: { order: movable },
      }),
    // `movableKey` stands in for `movable`, whose identity changes every render
    // while its contents do not; see the note on SEPARATOR above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gridId, movableKey, storage],
  );

  return [useSyncExternalStore(store.subscribe, store.get), store];
};
