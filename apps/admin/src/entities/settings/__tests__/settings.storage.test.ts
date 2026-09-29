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
} from "../index";

/**
 * This door's binding, against the grid's own store (`D22.2`, ADR-0077 §4;
 * ADR-0045, ADR-0041).
 *
 * The writer and the adapter are `@repo/account`'s, and what they do over a
 * seam is certified in that package against a key scheme of its suite's own.
 * What only this app can ask is what this door adds: `@repo/grid`'s key
 * scheme under this app's device prefix, bound over a cache of the caller's
 * choosing.
 *
 * So the claim under test is the one ADR-0041 asked to be held to, and it
 * needs the store the package may not name: `createGridPreferences` is used
 * here **unmodified**, over a third implementation of three functions reached
 * through this door, and it cannot tell.
 *
 * Every assertion runs against an in-memory `PreferenceStorage` as the local
 * cache and a spy as the sender — **the adapter seam is also the test seam**.
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

  it("discards a local entry the schema refuses, which the adapter left on the device", () => {
    const { adapter, cache, writer } = setup();

    cache.write(KEY, '{"v":1,"sizing":{"email":1},"order":[],"hidden":[]}');
    writer.sync(resource());

    // The adapter's half — it hands the store the device's own corruption and
    // uploads none of it — is the package's to prove. This is the half that
    // needs the store: it validates on its own read, as it always has
    // (ADR-0041, amended D4.5), so what reaches a grid is the defaults.
    expect(
      createGridPreferences({
        gridId: "staff",
        storage: adapter,
        defaults: { order: ["email", "status"] },
      }).get().sizing,
    ).toEqual({});
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
