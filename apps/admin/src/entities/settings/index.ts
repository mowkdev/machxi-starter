/**
 * The account's settings, as this app reads and writes them — a door onto
 * `@repo/account` since `D22.2` (ADR-0077 §2–§3; ADR-0045 §The client).
 *
 * The entity, its coalescing writer and the settings gate live in the package.
 * What is this app's is the one thing its copy had and the customer's did not:
 * **a grid**. ADR-0041's preference seam is `@repo/grid`'s, the package may not
 * depend on it, so the device cache and the two key translations are bound
 * here from `shared/grid` and handed over as {@link GRID_PREFERENCES}.
 */
import {
  createServerPreferenceAdapter as createServerPreferenceAdapterFor,
  createSettingsWriter as createSettingsWriterFor,
  type GridPreferenceSeam,
  type SettingsWriter,
} from "@repo/account";

import {
  createLocalStorageAdapter,
  gridStorageKey,
  parseGridStorageKey,
  type PreferenceStorage,
} from "@/shared/grid/preferences";
import { PreferenceStorageProvider } from "@/shared/grid/use-grid-preferences";

export {
  SETTINGS_WRITE_DEBOUNCE_MS,
  createSettingsApi,
  createSettingsProvider,
  settingsKeys,
  useSettings,
  useUpdateSettings,
  type SettingsApi,
  type SettingsProviderProps,
  type SettingsWriter,
} from "@repo/account";

/** The grid's key scheme under this app's device prefix, over one cache. */
const seamOver = (cache: PreferenceStorage): GridPreferenceSeam => ({
  cache,
  storageKey: gridStorageKey,
  parseStorageKey: parseGridStorageKey,
});

/**
 * What the settings gate is handed (`app/providers/settings.tsx`).
 *
 * **One module-level cache adapter**, and referential stability is
 * load-bearing twice over: the preference store is memoised on the adapter it
 * is given, and the writer holds this for the life of the session.
 * Constructing it per render would rebuild every grid's store every render,
 * which is an infinite loop rather than a slow path.
 */
export const GRID_PREFERENCES = {
  ...seamOver(createLocalStorageAdapter()),
  Provider: PreferenceStorageProvider,
} as const;

/**
 * The writer and the adapter over a cache of the caller's choosing, with this
 * app's key scheme bound — the signatures this slice has always had, which is
 * what lets its suite hand both an in-memory cache.
 */
export const createSettingsWriter = ({
  cache,
  delayMs,
}: {
  readonly cache: PreferenceStorage;
  readonly delayMs?: number;
}): SettingsWriter =>
  createSettingsWriterFor({ grids: seamOver(cache), delayMs });

export const createServerPreferenceAdapter = ({
  writer,
  cache,
}: {
  readonly writer: SettingsWriter;
  readonly cache: PreferenceStorage;
}): PreferenceStorage =>
  createServerPreferenceAdapterFor({ writer, grids: seamOver(cache) });
