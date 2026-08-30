import {
  DEFAULT_GRID_DENSITY,
  DEFAULT_LOCALE,
  DEFAULT_THEME,
  type GridPreferencesV1,
  type StaffSettingsResource,
  type UpdateStaffSettingsBody,
} from "@repo/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createGridPreferences,
  createMemoryStorage,
  gridStorageKey,
} from "@/shared/grid/preferences";

import {
  createServerPreferenceAdapter,
  createSettingsWriter,
  SETTINGS_WRITE_DEBOUNCE_MS,
} from "../settings.storage";

/**
 * The server adapter, against the seam it implements (ADR-0045, ADR-0041).
 *
 * Every assertion here runs against an in-memory `PreferenceStorage` as the
 * local cache and a spy as the sender, which is the same property ADR-0041
 * built the adapter for: **the adapter seam is also the test seam**. Nothing
 * in this file mounts React or opens a socket, because nothing in the writer
 * knows about either.
 *
 * The claim under test throughout is the one ADR-0041 asked to be held to:
 * `createGridPreferences` is used here **unmodified**, over a third
 * implementation of three functions, and it cannot tell.
 */

const KEY = gridStorageKey("staff");

const entry = (width: number): GridPreferencesV1 => ({
  v: 1,
  sizing: { email: width },
  order: ["email", "status"],
  hidden: [],
});

const resource = (
  grids: Record<string, GridPreferencesV1> = {},
): StaffSettingsResource => ({
  theme: DEFAULT_THEME,
  locale: DEFAULT_LOCALE,
  gridDensity: DEFAULT_GRID_DENSITY,
  grids,
});

const setup = () => {
  const cache = createMemoryStorage();
  const sent: UpdateStaffSettingsBody[] = [];
  const writer = createSettingsWriter({ cache });
  const stop = writer.subscribe((body) => {
    sent.push(body);
  });

  return {
    cache,
    sent,
    stop,
    writer,
    adapter: createServerPreferenceAdapter({ writer, cache }),
  };
};

/** Past the coalescing window, which is where a burst becomes one request. */
const settle = () => {
  vi.advanceTimersByTime(SETTINGS_WRITE_DEBOUNCE_MS);
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the server preference adapter", () => {
  it("prefers the account's arrangement over the device's", () => {
    const { adapter, cache, writer } = setup();

    cache.write(KEY, JSON.stringify(entry(100)));
    writer.sync(resource({ staff: entry(300) }));

    // The first-sync rule: the server entry wins if present. A second machine
    // must not push a stale local layout over the one the operator built.
    expect(JSON.parse(adapter.read(KEY) ?? "null")).toMatchObject({
      sizing: { email: 300 },
    });
  });

  it("adopts a grid only this device knows about, and uploads it once", () => {
    const { adapter, cache, sent, writer } = setup();

    cache.write(KEY, JSON.stringify(entry(120)));
    writer.sync(resource());

    expect(JSON.parse(adapter.read(KEY) ?? "null")).toMatchObject({
      sizing: { email: 120 },
    });

    settle();

    expect(sent).toEqual([{ grids: { staff: entry(120) } }]);

    // Read again: adoption is a decision made once per grid, not per mount.
    adapter.read(KEY);
    settle();

    expect(sent).toHaveLength(1);
  });

  it("never uploads a local entry the schema refuses", () => {
    const { adapter, cache, sent, writer } = setup();

    cache.write(KEY, '{"v":1,"sizing":{"email":1},"order":[],"hidden":[]}');
    writer.sync(resource());

    // A width of 1 is a column an operator can see and cannot grab; it is out
    // of bounds on both paths (ADR-0041, amended D4.5). The device keeps its
    // own corruption — the store discards it on read, as it always has — but
    // nothing makes it the account's.
    expect(adapter.read(KEY)).toBe(cache.read(KEY));

    settle();

    expect(sent).toEqual([]);
    expect(
      createGridPreferences({
        gridId: "staff",
        storage: adapter,
        defaults: { order: ["email", "status"] },
      }).get().sizing,
    ).toEqual({});
  });

  it("coalesces a burst of writes and a theme into one request", () => {
    const { adapter, sent, writer } = setup();

    writer.sync(resource());

    // What a drag on a column edge looks like: one write per frame.
    adapter.write(KEY, JSON.stringify(entry(200)));
    adapter.write(KEY, JSON.stringify(entry(240)));
    adapter.write(KEY, JSON.stringify(entry(280)));
    writer.setTheme("dark");

    expect(sent).toEqual([]);

    settle();

    expect(sent).toEqual([{ theme: "dark", grids: { staff: entry(280) } }]);
  });

  it("says `null` for a grid the operator reset", () => {
    const { adapter, cache, sent, writer } = setup();

    writer.sync(resource({ staff: entry(300) }));
    adapter.remove(KEY);

    expect(cache.read(KEY)).toBeNull();

    settle();

    expect(sent).toEqual([{ grids: { staff: null } }]);
  });

  it("leaves a key it cannot parse to the local cache, and never sends it", () => {
    const { adapter, sent, writer } = setup();

    writer.sync(resource());

    // The theme's own key, and a future `v2` grid entry: neither is this
    // adapter's to translate, so both fall through to the device.
    adapter.write("machxi.admin.theme", "dark");
    adapter.write("machxi.admin.grid:staff:v2", "{}");

    expect(adapter.read("machxi.admin.theme")).toBe("dark");
    expect(adapter.read("machxi.admin.grid:staff:v2")).toBe("{}");

    settle();

    expect(sent).toEqual([]);
  });

  it("keeps a pending write when a later response re-seeds the mirror", () => {
    const { adapter, sent, writer } = setup();

    writer.sync(resource({ staff: entry(300) }));
    adapter.write(KEY, JSON.stringify(entry(500)));

    // The response of an *earlier* flush, arriving while this one is still in
    // the window. Letting it win would lose the operator's most recent action.
    writer.sync(resource({ staff: entry(300) }));

    expect(JSON.parse(adapter.read(KEY) ?? "null")).toMatchObject({
      sizing: { email: 500 },
    });

    settle();

    expect(sent).toEqual([{ grids: { staff: entry(500) } }]);
  });

  it("holds a write made before a sender is installed", () => {
    const cache = createMemoryStorage();
    const writer = createSettingsWriter({ cache });
    const adapter = createServerPreferenceAdapter({ writer, cache });
    const sent: UpdateStaffSettingsBody[] = [];

    writer.sync(resource());
    adapter.write(KEY, JSON.stringify(entry(180)));
    // The density half of the same window (`D11.6`): the branch that decides
    // whether anything is waiting has to name every pending scalar, and a
    // check that still read only the theme and the grids would drop a
    // density-only write made before the effect installed the sender.
    writer.setGridDensity("compact");
    settle();

    writer.subscribe((body) => {
      sent.push(body);
    });

    // Subscribing flushes what was waiting: the effect that installs the
    // sender runs after the render that may already have adopted a grid.
    expect(sent).toEqual([
      { gridDensity: "compact", grids: { staff: entry(180) } },
    ]);
  });

  it("holds a density written before a sender is installed, on its own", () => {
    // The same branch with nothing else pending — a toggle in the page-header
    // band is one click and may well be the only thing in its window.
    const cache = createMemoryStorage();
    const writer = createSettingsWriter({ cache });
    const sent: UpdateStaffSettingsBody[] = [];

    writer.sync(resource());
    writer.setGridDensity("compact");
    settle();

    writer.subscribe((body) => {
      sent.push(body);
    });

    expect(sent).toEqual([{ gridDensity: "compact" }]);
  });

  it("drops nothing on the floor when disposed mid-window", () => {
    const { adapter, sent, writer } = setup();

    writer.sync(resource());
    adapter.write(KEY, JSON.stringify(entry(180)));
    writer.dispose();
    settle();

    // A pending write when the tab closes is lost — the "not persisting"
    // outcome ADR-0045 accepts rather than fighting with `sendBeacon`. What
    // must not happen is a request firing after the app is gone.
    expect(sent).toEqual([]);
  });
});

describe("the store above the seam", () => {
  it("restores an account arrangement into an unmodified store", () => {
    const { adapter, writer } = setup();

    writer.sync(resource({ staff: entry(300) }));

    const store = createGridPreferences({
      gridId: "staff",
      storage: adapter,
      defaults: { order: ["email", "status"] },
    });

    expect(store.get().sizing).toEqual({ email: 300 });
  });

  it("falls back to config defaults on a row edited to garbage, silently", () => {
    const { adapter, writer } = setup();

    // What a hand-edited `jsonb` column can return: the server stores what it
    // validated, and this is the case where somebody went round it.
    writer.sync(
      resource({
        staff: { v: 2, nonsense: true } as unknown as GridPreferencesV1,
      }),
    );

    const store = createGridPreferences({
      gridId: "staff",
      storage: adapter,
      defaults: { order: ["email", "status"] },
    });

    expect(store.get()).toEqual({
      sizing: {},
      order: ["email", "status"],
      hidden: [],
    });
  });

  it("carries one client's column width to another client of the same account", () => {
    // One account, two browsers — the acceptance sketch, with the API stood in
    // for by a shared resource the second client is seeded from.
    let account = resource();

    const first = setup();
    first.writer.sync(account);
    first.writer.subscribe((body) => {
      account = {
        ...account,
        grids: { ...account.grids, ...(body.grids as typeof account.grids) },
      };
    });

    const storeA = createGridPreferences({
      gridId: "staff",
      storage: first.adapter,
      defaults: { order: ["email", "status"] },
    });

    storeA.set({
      sizing: { email: 420 },
      order: ["email", "status"],
      hidden: [],
    });
    settle();

    const second = setup();
    second.writer.sync(account);

    const storeB = createGridPreferences({
      gridId: "staff",
      storage: second.adapter,
      defaults: { order: ["email", "status"] },
    });

    expect(storeB.get().sizing).toEqual({ email: 420 });
  });
});
