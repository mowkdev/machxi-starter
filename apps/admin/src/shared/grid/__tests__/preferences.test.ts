import { describe, expect, it, vi } from "vitest";

import {
  createGridPreferences,
  createLocalStorageAdapter,
  createMemoryStorage,
  gridStorageKey,
  reconcile,
  type PreferenceStorage,
} from "../preferences";

/**
 * The preferences store (ADR-0041, `D4.5`).
 *
 * Everything here runs against an in-memory `PreferenceStorage`, which is the
 * ADR's own point twice over: the adapter seam is what a server-backed
 * user-settings adapter will slot into later, and it is what makes this store
 * testable without a browser. If these assertions need `window`, the seam has
 * stopped being a seam.
 */

const DEFAULTS = { order: ["email", "status", "createdAt"] } as const;

const storeWith = (storage: PreferenceStorage, gridId = "staff") =>
  createGridPreferences({ gridId, storage, defaults: DEFAULTS });

const stored = (storage: PreferenceStorage, gridId = "staff"): unknown =>
  JSON.parse(storage.read(gridStorageKey(gridId)) ?? "null");

describe("defaults", () => {
  it("starts from the config when storage is empty", () => {
    const store = storeWith(createMemoryStorage());

    expect(store.get()).toEqual({
      sizing: {},
      order: ["email", "status", "createdAt"],
      hidden: [],
    });
  });

  it("writes nothing until something is set", () => {
    // "No opinion" is not the same value as "my opinion happens to match the
    // config": an entry written at mount would freeze today's column set into
    // storage and make tomorrow's new column inherit a stale layout.
    const storage = createMemoryStorage();

    storeWith(storage);

    expect(storage.read(gridStorageKey("staff"))).toBeNull();
  });
});

describe("the round trip", () => {
  it("restores what was set, per grid id", () => {
    const storage = createMemoryStorage();

    storeWith(storage, "staff").set({
      sizing: { email: 320 },
      order: ["status", "email", "createdAt"],
      hidden: ["createdAt"],
    });

    // A second store over the same storage is what a reload is.
    expect(storeWith(storage, "staff").get()).toEqual({
      sizing: { email: 320 },
      order: ["status", "email", "createdAt"],
      hidden: ["createdAt"],
    });

    /*
     * And a different grid is a different entry. Two grids sharing an id would
     * fight over one value and each would restore the other's layout, which is
     * the whole reason `gridId` is a prop rather than a constant.
     */
    expect(storeWith(storage, "users").get()).toEqual({
      sizing: {},
      order: ["email", "status", "createdAt"],
      hidden: [],
    });
  });

  it("stores column names and numbers, and nothing else", () => {
    /*
     * The ADR-0033 claim, asserted rather than promised. This is non-credential
     * display state — an XSS that reads it learns which columns an operator
     * likes wide — and it stays that way only if no row data, no filter value
     * and nothing typed into the grid can reach the payload. The shape is the
     * guard: three slices of column ids and numbers, plus a version.
     */
    const storage = createMemoryStorage();

    storeWith(storage).set({
      sizing: { email: 320 },
      order: ["status", "email", "createdAt"],
      hidden: ["createdAt"],
    });

    expect(stored(storage)).toEqual({
      v: 1,
      sizing: { email: 320 },
      order: ["status", "email", "createdAt"],
      hidden: ["createdAt"],
    });
  });

  it("names its key by grid and version", () => {
    // Versioned in the key as well as the payload, extending the naming the
    // theme preference began.
    expect(gridStorageKey("staff")).toBe("machxi.admin.grid:staff:v1");
  });

  it("notifies subscribers, and stops when they leave", () => {
    const store = storeWith(createMemoryStorage());
    const listener = vi.fn();

    const unsubscribe = store.subscribe(listener);

    store.set({ ...store.get(), hidden: ["status"] });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.set({ ...store.get(), hidden: [] });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("returns a stable snapshot between writes", () => {
    /*
     * `useSyncExternalStore` re-renders whenever the snapshot is not
     * `Object.is`-equal to the last one, so a fresh object per read would be an
     * infinite render loop — the trap the session store avoids the same way.
     */
    const store = storeWith(createMemoryStorage());

    expect(store.get()).toBe(store.get());
  });
});

describe("a stored value the store will not trust", () => {
  const survives = (raw: string) => {
    const storage = createMemoryStorage();

    storage.write(gridStorageKey("staff"), raw);

    return storeWith(storage).get();
  };

  const asDefaults = {
    sizing: {},
    order: ["email", "status", "createdAt"],
    hidden: [],
  };

  /*
   * Every one of these falls back to config defaults **without a toast, a log
   * or an exception**: corrupt preferences must never break a grid. There is no
   * operator action a message here would prompt, and the grid they get is the
   * one the config describes — the same grid they had before they touched a
   * column.
   */
  it("falls back on unparseable JSON", () => {
    expect(survives("{not json")).toEqual(asDefaults);
  });

  it("falls back on a version it does not know", () => {
    expect(
      survives(
        JSON.stringify({ v: 2, sizing: {}, order: ["email"], hidden: [] }),
      ),
    ).toEqual(asDefaults);
  });

  it("falls back on a slice of the wrong shape", () => {
    expect(
      survives(
        JSON.stringify({ v: 1, sizing: {}, order: "email", hidden: [] }),
      ),
    ).toEqual(asDefaults);
  });

  it("falls back on a width the write path would never have produced", () => {
    /*
     * The read path agrees with the write path, which is the point: a width is
     * clamped between 64 and 2000 on the way in, so anything outside that was
     * hand-edited. A `1` would render a column an operator can see and cannot
     * grab; a `1e12` would make one column the whole table. Both discard the
     * entry rather than being applied.
     */
    for (const width of [0, -10, 1, 1e12])
      expect(
        survives(
          JSON.stringify({
            v: 1,
            sizing: { email: width },
            order: [],
            hidden: [],
          }),
        ),
        `width ${width}`,
      ).toEqual(asDefaults);
  });

  it("falls back on an entry too large to render", () => {
    /*
     * `localStorage` holds several megabytes, so an unbounded `order` is
     * hundreds of thousands of ids — and the Columns menu renders one row per
     * id, which would hang the tab on the one surface that contains "Reset to
     * defaults". Bounding the arrays is what keeps a crafted entry from
     * becoming a grid nobody can use *or* reset.
     */
    expect(
      survives(
        JSON.stringify({
          v: 1,
          sizing: {},
          order: Array.from({ length: 500 }, (_, index) => `c${index}`),
          hidden: [],
        }),
      ),
    ).toEqual(asDefaults);
  });
});

describe("reconciliation against the config as it is now", () => {
  it("drops ids the config no longer declares", () => {
    expect(
      reconcile(
        {
          sizing: { email: 320, department: 200 },
          order: ["department", "email", "status", "createdAt"],
          hidden: ["department", "status"],
        },
        DEFAULTS,
      ),
    ).toEqual({
      sizing: { email: 320 },
      order: ["email", "status", "createdAt"],
      hidden: ["status"],
    });
  });

  it("de-duplicates a repeated id rather than letting it through", () => {
    /*
     * The allow-list alone filters but does not dedupe, and a repeat is not
     * harmless: the Columns menu keys its rows by id, so two rows would share a
     * React key and a `<label for>` — one checkbox appearing to toggle both,
     * and the reorder buttons only ever moving the first.
     */
    expect(
      reconcile(
        {
          sizing: {},
          order: ["status", "status", "email", "status"],
          hidden: ["email", "email"],
        },
        DEFAULTS,
      ),
    ).toEqual({
      sizing: {},
      order: ["status", "email", "createdAt"],
      hidden: ["email"],
    });
  });

  it("appends a column the config gained, at its defaults", () => {
    expect(
      reconcile(
        { sizing: {}, order: ["status", "email"], hidden: ["email"] },
        DEFAULTS,
      ),
    ).toEqual({
      // The operator's arrangement is kept and the newcomer lands after it —
      // visible, unsized, and in config declaration order.
      sizing: {},
      order: ["status", "email", "createdAt"],
      hidden: ["email"],
    });
  });

  it("absorbs a rename as a reset of that column alone", () => {
    /*
     * The property the whole rule exists for: **a config change must never
     * strand an operator on a stale layout.** A renamed column is a dropped id
     * and an added one at once, so it reverts to default while everything
     * around it survives — and there is no storage migration to write, ever.
     */
    expect(
      reconcile(
        {
          sizing: { emailAddress: 320 },
          order: ["emailAddress", "status", "createdAt"],
          hidden: ["emailAddress"],
        },
        DEFAULTS,
      ),
    ).toEqual({
      sizing: {},
      order: ["status", "createdAt", "email"],
      hidden: [],
    });
  });
});

describe("reset", () => {
  it("removes the entry rather than writing the defaults into it", () => {
    /*
     * The difference matters tomorrow: an entry holding today's defaults would
     * make a column added later arrive at a frozen snapshot of this config,
     * where an absent entry lets it arrive at its own default.
     */
    const storage = createMemoryStorage();
    const store = storeWith(storage);

    store.set({ sizing: { email: 320 }, order: ["email"], hidden: ["status"] });
    expect(storage.read(gridStorageKey("staff"))).not.toBeNull();

    store.reset();

    expect(storage.read(gridStorageKey("staff"))).toBeNull();
    expect(store.get()).toEqual({
      sizing: {},
      order: ["email", "status", "createdAt"],
      hidden: [],
    });
  });
});

describe("a storage that refuses", () => {
  it("keeps the grid working when writing throws", () => {
    /*
     * Quota, or a private mode that has `localStorage` and throws on use.
     * **Preferences failing to persist must degrade to preferences not
     * persisting, never to a broken grid** — a work surface is not something to
     * take away over a storage quota.
     */
    const hostile: PreferenceStorage = {
      read: () => {
        throw new Error("nope");
      },
      write: () => {
        throw new Error("nope");
      },
      remove: () => {
        throw new Error("nope");
      },
    };

    const store = storeWith(hostile);

    // Read, write and remove all throw, and none of the three reaches a caller:
    // the guard is in the store as well as in the shipped adapter, so the
    // promise holds for a future adapter nobody has written yet.
    expect(store.get()).toEqual({
      sizing: {},
      order: ["email", "status", "createdAt"],
      hidden: [],
    });
    expect(() => {
      store.set({ ...store.get(), hidden: ["status"] });
    }).not.toThrow();
    expect(store.get().hidden).toEqual(["status"]);
    expect(() => {
      store.reset();
    }).not.toThrow();
  });

  it("swallows a `localStorage` that throws on write", () => {
    // Quota is the real case, and the shipped adapter is where it lands first.
    const adapter = createLocalStorageAdapter();

    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() => {
      adapter.write("machxi.admin.grid:staff:v1", "{}");
    }).not.toThrow();

    vi.restoreAllMocks();
  });
});
