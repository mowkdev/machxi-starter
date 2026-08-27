import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";

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
 * The default adapter, and the one line ADR-0045 said would change here.
 *
 * ADR-0041 wrote of this file that it is "the reason the future server-backed
 * adapter changes one file rather than a component tree", and `D6.3` is the
 * day that claim is spent. The default stops being `localStorage` outright and
 * becomes *whatever the app has provided*, defaulting to `localStorage` when
 * nothing has: `app/providers` puts the ADR-0045 server adapter here for an
 * authenticated session and leaves it alone otherwise, so a grid signed out —
 * or in any test that does not wire settings — behaves exactly as it did.
 *
 * The store, its guards and `AppGrid` are untouched by this, which is the
 * whole of the ADR-0041 claim `D6.3` exists to falsify.
 *
 * One module-level instance rather than one per store: the store is memoised
 * on the adapter's identity, so a fresh adapter per render would rebuild the
 * store every render and hand `useSyncExternalStore` a new snapshot each time —
 * an infinite loop rather than a slow path. A context default has to be stable
 * for the same reason a prop does.
 */
const LOCAL_STORAGE_ADAPTER: PreferenceStorage = createLocalStorageAdapter();

const PreferenceStorageContext = createContext<PreferenceStorage>(
  LOCAL_STORAGE_ADAPTER,
);

/**
 * Supplies the adapter every grid below it persists through.
 *
 * The value **must be referentially stable** for the reason the `AppGrid`
 * prop's own doc gives; `app/providers/settings.tsx` holds it in a `useMemo`
 * that outlives the query it is built from.
 */
export const PreferenceStorageProvider = PreferenceStorageContext.Provider;

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
  /*
   * The prop still wins (ADR-0045): it is the per-call-site override, the
   * context is the app's default, and `localStorage` is the default's default.
   */
  const provided = useContext(PreferenceStorageContext);

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
          gridId === undefined ? createMemoryStorage() : (storage ?? provided),
        defaults: { order: movable },
      }),
    // `movableKey` stands in for `movable`, whose identity changes every render
    // while its contents do not; see the note on SEPARATOR above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gridId, movableKey, storage, provided],
  );

  return [useSyncExternalStore(store.subscribe, store.get), store];
};
