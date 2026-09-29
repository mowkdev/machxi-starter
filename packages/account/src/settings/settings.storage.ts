import {
  gridPreferencesSchema,
  type GridDensity,
  type GridPreferencesV1,
  type Theme,
} from "@repo/contracts";

import type { AccountSettings, AccountSettingsPatch } from "./settings.types";

/**
 * The server-backed preference adapter, and the writer behind it (ADR-0045
 * §The server adapter) — one file for both apps since `D22.2` (ADR-0077 §2).
 *
 * **The grid half is a parameter, and an app with no grid passes none.** The
 * customer app carried this file with two thirds of it cut away, because
 * ADR-0055 §3 keeps `@repo/grid` out of that app until a domain entity
 * arrives: no store, no key to parse, no arrangement to mirror. That
 * subtraction is now the absence of {@link GridPreferenceSeam}. With no seam
 * no adapter is built and the gate never seeds the mirror, so nothing reads or
 * writes a grid, nothing is adopted from a device, and a flush carries the
 * scalars alone — the body that app's own writer sent. This
 * package does not depend on `@repo/grid`: the three functions and the two
 * key translations arrive from the app that has one.
 *
 * This is the second implementation of ADR-0041's three-function seam, and the
 * whole point of the exercise is what it is *not* allowed to do: the store
 * above it does not know a network exists, `createGridPreferences` and
 * `AppGrid` do not change, and a write that fails degrades to "not persisting"
 * rather than to a broken grid. ADR-0041 named that claim — "when it lands, the
 * store and AppGrid do not change" — as the one this design should be held to.
 *
 * Two translations happen here and nowhere else:
 *
 * - **Key ↔ `gridId`.** The store speaks `<prefix>.grid:<gridId>:v1`; the
 *   wire speaks `grids[gridId]`. A key this cannot parse falls through to the
 *   local cache and is never sent, so the store never learns that a `gridId` is
 *   on the wire.
 * - **Synchronous ↔ debounced.** `read` is synchronous because ADR-0041 made it
 *   synchronous, so it answers from an in-memory mirror seeded before any grid
 *   mounts. `write` and `remove` update the mirror and schedule one coalesced
 *   `PATCH`.
 */

/**
 * One second, and it is a **coalescing** window rather than a delay.
 *
 * A pointer drag on a column edge produces a write per frame and a toggled
 * theme is a write of its own; within the window they collapse into one body
 * carrying only the changed keys. Per-key merge semantics on the server are
 * what make sending only those keys safe (ADR-0045 §Endpoints).
 */
export const SETTINGS_WRITE_DEBOUNCE_MS = 1_000;

/**
 * ADR-0041's three-function seam, written out rather than imported.
 *
 * It is `@repo/grid`'s `PreferenceStorage` member for member, so either is
 * assignable to the other — which is what lets the admin hand this package
 * its grid adapter without this package naming the grid.
 */
export interface PreferenceStorage {
  readonly read: (key: string) => string | null;
  readonly write: (key: string, value: string) => void;
  readonly remove: (key: string) => void;
}

/** What an app with a grid hands over: the device cache and its key scheme. */
export interface GridPreferenceSeam {
  /** ADR-0041's `localStorage` adapter, kept in front as the offline cache. */
  readonly cache: PreferenceStorage;
  /** `gridId` → the key the store reads, under the app's device prefix. */
  readonly storageKey: (gridId: string) => string;
  /** The inverse: `null` for any key that is not a grid's. */
  readonly parseStorageKey: (key: string) => string | null;
}

export interface SettingsWriterDeps {
  /** Absent in an app that mounts no grid (ADR-0055 §3). */
  readonly grids?: GridPreferenceSeam | undefined;
  readonly delayMs?: number | undefined;
}

/** What a flush hands its subscriber: only the keys that changed. */
export type SettingsFlush = (body: AccountSettingsPatch) => void;

/**
 * A stored entry, validated before it is believed — in **both** directions.
 *
 * On the way up, so a corrupt local cache is never uploaded as though it were
 * an arrangement. On the way in from the store's `write`, so a caller that
 * hands this adapter something the schema refuses cannot make the account row
 * the place the corruption lives. The store validates on its own read as well,
 * which is the guard ADR-0041's D4.5 amendment made the *store's* guarantee
 * rather than an adapter's courtesy; this is the adapter declining to make it
 * do the work twice for nothing.
 */
const parseEntry = (raw: string): GridPreferencesV1 | null => {
  try {
    const parsed = gridPreferencesSchema.safeParse(JSON.parse(raw));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export const createSettingsWriter = ({
  grids: seam,
  delayMs = SETTINGS_WRITE_DEBOUNCE_MS,
}: SettingsWriterDeps = {}) => {
  /**
   * The mirror: what this client believes the account's **grids** now say.
   *
   * The theme is deliberately not mirrored here. Its reader is the theme
   * provider, which adopts it from the query's own answer, so a copy in this
   * closure would be a second owner of one fact with nobody reading it — and
   * the drift would be invisible. What the writer holds about the theme is
   * only what it is about to *send*.
   */
  const grids = new Map<string, GridPreferencesV1>();
  let seeded = false;

  /** What the next flush will carry. `null` for a grid key is a delete. */
  const pendingGrids = new Map<string, GridPreferencesV1 | null>();
  let pendingTheme: Theme | null = null;
  /**
   * The density half (`D11.6`), and it is not mirrored either — for the same
   * reason the theme is not: its reader is the density provider, which adopts
   * from the query's own answer, so a copy here would be a second owner of one
   * fact with nobody reading it.
   */
  let pendingGridDensity: GridDensity | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Grid ids this writer has already made up its mind about.
   *
   * The first-sync rule needs to know, per grid, whether the local cache has
   * ever been consulted. It cannot be answered by enumerating the cache —
   * `PreferenceStorage` has three functions and none of them lists keys — so
   * the question is answered where it is actually asked, on the first `read`
   * of that key. Every grid an operator opens is adopted exactly once, which
   * is the same outcome for every grid that has an arrangement worth keeping.
   */
  const decided = new Set<string>();

  /**
   * Where a flush goes, installed from an effect rather than at construction.
   *
   * The sender is `useUpdateSettings().mutateAsync`, which belongs to a
   * component and is therefore a render-time value; a writer that captured one
   * at construction would hold whichever it was given first. The observable
   * shape ADR-0033's session store established solves it the same way it
   * solves everything else here — the writer knows nothing about React, and
   * React subscribes to it.
   */
  let send: SettingsFlush | null = null;

  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }

    if (
      pendingTheme === null &&
      pendingGridDensity === null &&
      pendingGrids.size === 0
    ) {
      return;
    }

    /*
     * No subscriber yet — keep the pending payload rather than dropping it.
     * `subscribe` flushes on arrival, so a write made in the gap between the
     * writer being built and the effect running still lands.
     */
    if (send === null) return;

    const sentTheme = pendingTheme;
    const sentDensity = pendingGridDensity;
    const sentGrids =
      pendingGrids.size === 0 ? null : Object.fromEntries(pendingGrids);

    pendingTheme = null;
    pendingGridDensity = null;
    pendingGrids.clear();

    /*
     * The mirror keeps what it holds whatever happens next: a failed write
     * degrades to "not persisting", never to a grid that forgets what the
     * operator just did. The operator hears about it once, from the global
     * mutation handler's toast (ADR-0043) — coalesced with everything else in
     * this body, so a flaky connection costs one toast per flush.
     */
    send({
      ...(sentTheme === null ? {} : { theme: sentTheme }),
      ...(sentDensity === null ? {} : { gridDensity: sentDensity }),
      ...(sentGrids === null ? {} : { grids: sentGrids }),
    });
  };

  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer);

    timer = setTimeout(flush, delayMs);
  };

  return {
    /**
     * Installs the sender, and flushes anything that was waiting for one.
     *
     * Returns the remover, so a provider's effect is a one-liner and a second
     * subscriber cannot silently replace the first.
     */
    subscribe: (next: SettingsFlush): (() => void) => {
      send = next;

      if (
        pendingTheme !== null ||
        pendingGridDensity !== null ||
        pendingGrids.size > 0
      ) {
        flush();
      }

      return () => {
        if (send === next) send = null;
      };
    },

    /**
     * The settings query's answer, applied to the mirror.
     *
     * **First call — the first-sync rule.** Server entries become the mirror
     * wholesale; a grid the server has never heard of is adopted lazily, on
     * its first `read` (see {@link decided}). So nobody loses the arrangement
     * they built before this API existed, and a second device never overwrites
     * the first device's uploaded arrangement with a stale local one.
     *
     * **Later calls — re-seed.** The server wins, *except* for keys with a
     * write still pending in the debounce window: those are what this client
     * is about to say, and letting the response of an earlier flush overwrite
     * them would lose the operator's most recent action.
     */
    sync: (resource: AccountSettings): void => {
      if (!seeded) {
        seeded = true;

        for (const [gridId, entry] of Object.entries(resource.grids)) {
          grids.set(gridId, entry);
          decided.add(gridId);
        }

        return;
      }

      const server = new Map(Object.entries(resource.grids));

      for (const gridId of new Set([...grids.keys(), ...server.keys()])) {
        if (pendingGrids.has(gridId)) continue;

        const entry = server.get(gridId);

        if (entry === undefined) grids.delete(gridId);
        else grids.set(gridId, entry);
      }
    },

    /** What the account says about this grid, as the string the store reads. */
    readGrid: (gridId: string): string | null => {
      const entry = grids.get(gridId);

      if (entry !== undefined) return JSON.stringify(entry);

      /*
       * Unseeded means the query has not answered, so there is no account
       * opinion to prefer and nothing to adopt *to*; the adapter falls through
       * to the local cache, which is the app this panel was before ADR-0045.
       */
      if (!seeded || decided.has(gridId)) return null;

      decided.add(gridId);

      // No seam, so no device cache to adopt from: the account is the only
      // owner an arrangement could have.
      if (seam === undefined) return null;

      const raw = seam.cache.read(seam.storageKey(gridId));

      if (raw === null) return null;

      const parsed = parseEntry(raw);

      if (parsed === null) return null;

      // Local-only, and well formed: adopt it and upload it once.
      grids.set(gridId, parsed);
      pendingGrids.set(gridId, parsed);
      schedule();

      return raw;
    },

    /** `null` deletes the entry; anything the schema refuses is ignored. */
    setGrid: (gridId: string, value: string | null): void => {
      decided.add(gridId);

      if (value === null) {
        grids.delete(gridId);
        pendingGrids.set(gridId, null);
      } else {
        const parsed = parseEntry(value);

        if (parsed === null) return;

        grids.set(gridId, parsed);
        pendingGrids.set(gridId, parsed);
      }

      schedule();
    },

    /** Queues the theme half. The provider owns what is *displayed*. */
    setTheme: (next: Theme): void => {
      pendingTheme = next;
      schedule();
    },

    /**
     * Queues the density half (`D11.6`, ADR-0053 §2).
     *
     * The theme's twin down to the line, and it rides the coalescing writer
     * rather than going straight through `useUpdateSettings` — which is the
     * choice the locale made and this one declines. A density toggle is beside
     * the grid, one click from a column drag and from the theme, so the second
     * of coalescing that the locale had nothing to gain from is exactly the
     * second in which those three collapse into one body.
     */
    setGridDensity: (next: GridDensity): void => {
      pendingGridDensity = next;
      schedule();
    },

    /** Sends whatever is pending now rather than at the end of the window. */
    flush,

    /**
     * A pending write when the tab closes is lost, and that is the "not
     * persisting" outcome accepted rather than fought with `sendBeacon`, which
     * cannot carry the bearer token (ADR-0045).
     */
    dispose: (): void => {
      if (timer !== null) clearTimeout(timer);

      timer = null;
    },
  } as const;
};

export type SettingsWriter = ReturnType<typeof createSettingsWriter>;

/**
 * ADR-0041's three functions, over an account instead of a device.
 *
 * `localStorage` stays in front of it rather than behind it, and it is not a
 * fallback that will be removed: it is what themes the first paint and what
 * the signed-out app reads, both of which happen before there is a session to
 * ask (ADR-0045 §Alternatives).
 */
export const createServerPreferenceAdapter = ({
  writer,
  grids: { cache, parseStorageKey },
}: {
  readonly writer: SettingsWriter;
  /** The seam the writer was built with. */
  readonly grids: GridPreferenceSeam;
}): PreferenceStorage => ({
  read: (key) => {
    const gridId = parseStorageKey(key);

    return gridId === null
      ? cache.read(key)
      : (writer.readGrid(gridId) ?? cache.read(key));
  },

  write: (key, value) => {
    cache.write(key, value);

    const gridId = parseStorageKey(key);

    if (gridId !== null) writer.setGrid(gridId, value);
  },

  remove: (key) => {
    cache.remove(key);

    const gridId = parseStorageKey(key);

    if (gridId !== null) writer.setGrid(gridId, null);
  },
});
