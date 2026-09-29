import { createContext, useContext, type ReactNode } from "react";

import type {
  GridPreferenceSeam,
  PreferenceStorage,
} from "../../settings/settings.storage";

import { DEVICE_KEY_PREFIX } from "./render";

/**
 * A stand-in for the grid half an app hands this package (`D22.2`, ADR-0077
 * §2, §4; ADR-0041).
 *
 * `@repo/grid` is what an app with a grid binds and what this package may not
 * depend on, so the suite has the smallest thing of the same shape: a
 * three-function storage over a `Map`, a key scheme under the harness's
 * device prefix, and a context that carries whichever adapter the gate
 * mounts. The grid's own store is certified in its own package, and the
 * admin's door keeps the test that joins the two.
 */

/** An in-memory `PreferenceStorage`, which is ADR-0041's test seam. */
export const createMemoryCache = (): PreferenceStorage => {
  const entries = new Map<string, string>();

  return {
    read: (key) => entries.get(key) ?? null,
    write: (key, value) => {
      entries.set(key, value);
    },
    remove: (key) => {
      entries.delete(key);
    },
  };
};

const KEY_PATTERN = new RegExp(
  `^${DEVICE_KEY_PREFIX.replaceAll(".", "\\.")}\\.grid:([^:]+):v1$`,
);

/** `gridId` → `test.account.grid:<gridId>:v1`. */
export const gridKey = (gridId: string): string =>
  `${DEVICE_KEY_PREFIX}.grid:${gridId}:v1`;

/** The inverse: `null` for any key that is not a `v1` grid's. */
export const parseGridKey = (key: string): string | null =>
  KEY_PATTERN.exec(key)?.[1] ?? null;

export const seamOver = (cache: PreferenceStorage): GridPreferenceSeam => ({
  cache,
  storageKey: gridKey,
  parseStorageKey: parseGridKey,
});

const StorageContext = createContext<PreferenceStorage | null>(null);

/** What the gate mounts its adapter on, as the grid's own provider would. */
export const StorageProvider = ({
  value,
  children,
}: {
  readonly value: PreferenceStorage;
  readonly children: ReactNode;
}) => (
  <StorageContext.Provider value={value}>{children}</StorageContext.Provider>
);

/** The adapter in context, or `null` where the gate mounted none. */
export const useStorage = (): PreferenceStorage | null =>
  useContext(StorageContext);
