import {
  DEFAULT_GRID_DENSITY,
  DEFAULT_LOCALE,
  DEFAULT_THEME,
  type GridPreferencesV1,
} from "@repo/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SETTINGS_WRITE_DEBOUNCE_MS,
  createServerPreferenceAdapter,
  createSettingsWriter,
  type AccountSettings,
  type AccountSettingsPatch,
} from "../index";

import { createMemoryCache, gridKey, seamOver } from "./support/grid-seam";
import { DEVICE_KEY_PREFIX } from "./support/render";

/**
 * The coalescing writer and the server adapter, against the seam they are
 * handed (`D22.2`, ADR-0077 §2, §4; ADR-0045, ADR-0041).
 *
 * Every assertion here runs against an in-memory `PreferenceStorage` as the
 * device cache and a spy as the sender, which is the property ADR-0041 built
 * the adapter for: **the adapter seam is also the test seam**. Nothing in
 * this file mounts React or opens a socket, because nothing in the writer
 * knows about either.
 *
 * **The grid half is a parameter, and both of its values are asked.** With a
 * seam, the writer mirrors, adopts and uploads arrangements under a key
 * scheme that is this suite's own — not `@repo/grid`'s, which this package
 * may not name. With none, it is the writer an app without a grid runs on:
 * scalars alone, and no `grids` key on the wire.
 *
 * What is *not* asked here is the claim ADR-0041 wanted held — that the
 * grid's own store sits above this adapter unmodified. That needs the store,
 * so it is the admin door's suite.
 */

const KEY = gridKey("staff");

const entry = (width: number): GridPreferencesV1 => ({
  v: 1,
  sizing: { email: width },
  order: ["email", "status"],
  hidden: [],
});

const resource = (
  grids: Record<string, GridPreferencesV1> = {},
): AccountSettings => ({
  theme: DEFAULT_THEME,
  locale: DEFAULT_LOCALE,
  gridDensity: DEFAULT_GRID_DENSITY,
  grids,
});

const setup = () => {
  const cache = createMemoryCache();
  const grids = seamOver(cache);
  const sent: AccountSettingsPatch[] = [];
  const writer = createSettingsWriter({ grids });
  const stop = writer.subscribe((body) => {
    sent.push(body);
  });

  return {
    cache,
    grids,
    sent,
    stop,
    writer,
    adapter: createServerPreferenceAdapter({ writer, grids }),
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
    // own corruption — what the store above does with it is that store's
    // guarantee — but nothing makes it the account's.
    expect(adapter.read(KEY)).toBe(cache.read(KEY));

    settle();

    expect(sent).toEqual([]);
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
    const themeKey = `${DEVICE_KEY_PREFIX}.theme`;
    const futureKey = `${DEVICE_KEY_PREFIX}.grid:staff:v2`;

    writer.sync(resource());

    // The theme's own key, and a future `v2` grid entry: neither is this
    // adapter's to translate, so both fall through to the device.
    adapter.write(themeKey, "dark");
    adapter.write(futureKey, "{}");

    expect(adapter.read(themeKey)).toBe("dark");
    expect(adapter.read(futureKey)).toBe("{}");

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
    const grids = seamOver(createMemoryCache());
    const writer = createSettingsWriter({ grids });
    const adapter = createServerPreferenceAdapter({ writer, grids });
    const sent: AccountSettingsPatch[] = [];

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
    const writer = createSettingsWriter({
      grids: seamOver(createMemoryCache()),
    });
    const sent: AccountSettingsPatch[] = [];

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

describe("the writer with no grid seam", () => {
  /** The writer an app without a grid runs on (ADR-0055 §3). */
  const scalarsOnly = () => {
    const sent: AccountSettingsPatch[] = [];
    const writer = createSettingsWriter();

    writer.subscribe((body) => {
      sent.push(body);
    });

    return { sent, writer };
  };

  it("coalesces a theme and a density into one body of scalars", () => {
    const { sent, writer } = scalarsOnly();

    // Two cards on one section, clicked in the same breath.
    writer.setTheme("dark");
    writer.setGridDensity("compact");

    expect(sent).toEqual([]);

    settle();

    expect(sent).toEqual([{ theme: "dark", gridDensity: "compact" }]);
  });

  it("never puts a `grids` key on the wire", () => {
    const { sent, writer } = scalarsOnly();

    writer.setTheme("dark");
    settle();
    writer.setGridDensity("compact");
    settle();
    writer.setTheme("light");
    writer.flush();

    expect(sent).toEqual([
      { theme: "dark" },
      { gridDensity: "compact" },
      { theme: "light" },
    ]);

    // Absent, not empty: under ADR-0045's per-key merge a body is a statement
    // about the keys it names, and this app has nothing to say about grids.
    for (const body of sent) expect(body).not.toHaveProperty("grids");
  });

  it("has no arrangement to answer with, and adopts none", () => {
    const { sent, writer } = scalarsOnly();

    // Unseeded: the query has not answered.
    expect(writer.readGrid("staff")).toBeNull();

    writer.sync(resource());

    // Seeded, and the account has never heard of this grid — the branch that
    // consults the device cache where there is one. Here there is none, so
    // nothing is adopted and nothing is scheduled, on the first read or any
    // later one.
    expect(writer.readGrid("staff")).toBeNull();
    expect(writer.readGrid("staff")).toBeNull();

    settle();

    expect(sent).toEqual([]);
  });
});
