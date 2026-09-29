import { useSession } from "@repo/api-client";
import { useGridDensity, useTheme } from "@repo/app-services";
import type { GridPreferencesV1, Locale } from "@repo/contracts";
import { useLocale, type LocalePublisher } from "@repo/i18n";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMemo, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SETTINGS_WRITE_DEBOUNCE_MS,
  createSettingsProvider,
  type PreferenceStorage,
} from "../index";

import {
  StorageProvider,
  createMemoryCache,
  gridKey,
  seamOver,
  useStorage,
} from "./support/grid-seam";
import {
  DEVICE_KEY_PREFIX,
  ThemeSlot,
  authenticatedAs,
  createI18nSlot,
  createTestI18n,
  renderAccount,
} from "./support/render";
import { server } from "./support/server";
import {
  createSettingsHandlers,
  createSettingsMockState,
  type SettingsMockState,
} from "./support/settings.handlers";

/**
 * The settings gate, with what an app binds stood in for (`D22.2`, ADR-0077
 * §2, §4; ADR-0045 §The client, ADR-0046 §4).
 *
 * Three claims, and each is about *ordering* rather than markup:
 *
 * 1. Nothing below renders until an authenticated principal's settings have
 *    settled, because three readers take their first value as the answer: a
 *    grid reads its storage synchronously at mount, the i18n provider builds
 *    its instance from a locale, and the density provider seeds from one.
 * 2. What the account holds is what the app comes up in, and a change after
 *    that writes both what the device remembers and what the account does.
 * 3. Anonymous — before a sign-in, after a sign-out, or after a failed read —
 *    the app is the device alone. Signed out is decided by the *session*, not
 *    by whether the disabled query still holds the last principal's row.
 *
 * **Both values of the one parameter are asked**: the gate with no grid seam,
 * which is the customer's binding, and the gate over one, which is the
 * admin's. The slots are the harness's stand-ins and the boundary is a
 * pass-through, so what is proved here is the gate; that each app hands it
 * the real providers is each door's smoke test, and the one outcome the gate
 * leaves to the app's query client — the toast a refused write raises — is
 * asserted there.
 */

const THEME_KEY = `${DEVICE_KEY_PREFIX}.theme`;
const GRID_KEY = gridKey("staff");

const entry = (width: number): GridPreferencesV1 => ({
  v: 1,
  sizing: { email: width },
  order: ["email", "status"],
  hidden: [],
});

/** The account the gate is asked to come up as, on every claim about adoption. */
const ACCOUNT = {
  theme: "dark",
  locale: "lv",
  gridDensity: "compact",
  grids: {},
} as const;

/** The kit's boundary evicts a cache; the gate only asks that it render. */
const PrincipalCacheBoundary = ({
  children,
}: {
  readonly children: ReactNode;
}) => <>{children}</>;

const usePrincipalCacheOwner = (): string => {
  const { principal } = useSession();

  return principal === null ? "anonymous" : `${principal.kind}:${principal.id}`;
};

const ThemeProbe = () => {
  const { theme, setTheme } = useTheme();

  return (
    <>
      <output data-testid="theme">{theme}</output>
      <button
        onClick={() => {
          setTheme("light");
        }}
        type="button"
      >
        Light
      </button>
    </>
  );
};

const DensityProbe = () => {
  const { density, setDensity } = useGridDensity();

  return (
    <>
      <output data-testid="density">{density}</output>
      <button
        onClick={() => {
          setDensity("compact");
        }}
        type="button"
      >
        Compact
      </button>
    </>
  );
};

const LocaleProbe = () => {
  const { locale, setLocale } = useLocale();

  return (
    <>
      <output data-testid="locale">{locale}</output>
      <button
        onClick={() => {
          setLocale("lv");
        }}
        type="button"
      >
        Latvian
      </button>
    </>
  );
};

/**
 * Reads what a grid *would* read: once per adapter, synchronously, in the
 * render that mounts it — ADR-0041's `read`, which is the reason the gate
 * exists.
 */
const GridProbe = () => {
  const storage = useStorage();

  const width = useMemo(() => {
    const raw = storage?.read(GRID_KEY) ?? null;

    if (raw === null) return "auto";

    return String((JSON.parse(raw) as GridPreferencesV1).sizing["email"]);
  }, [storage]);

  return <output data-testid="width">{width}</output>;
};

interface GateOptions {
  readonly anonymous?: boolean;
  /** The device's grid cache; absent, the gate is built with no seam. */
  readonly cache?: PreferenceStorage;
  /** Every `adopted` the i18n slot was rendered with, in order. */
  readonly adoptedLocales?: (Locale | undefined)[];
}

const renderGate = (
  state: SettingsMockState,
  { anonymous = false, cache, adoptedLocales }: GateOptions = {},
) => {
  server.use(...createSettingsHandlers(state));

  const I18nSlot = createI18nSlot(createTestI18n());

  const RecordingI18nSlot = (props: {
    readonly children: ReactNode;
    readonly adopted?: Locale | undefined;
    readonly publish?: LocalePublisher | undefined;
  }) => {
    adoptedLocales?.push(props.adopted);

    return <I18nSlot {...props} />;
  };

  const SettingsProvider = createSettingsProvider({
    ThemeProvider: ThemeSlot,
    I18nProvider: RecordingI18nSlot,
    PrincipalCacheBoundary,
    usePrincipalCacheOwner,
    grids:
      cache === undefined
        ? undefined
        : { ...seamOver(cache), Provider: StorageProvider },
  });

  return renderAccount(
    <SettingsProvider fallback={<p>Loading settings…</p>}>
      <ThemeProbe />
      <DensityProbe />
      <LocaleProbe />
      <GridProbe />
    </SettingsProvider>,
    {
      preferences: false,
      ...(anonymous ? {} : { store: authenticatedAs() }),
    },
  );
};

/** A device cache that already holds an arrangement for the one grid. */
const deviceWith = (width: number): PreferenceStorage => {
  const cache = createMemoryCache();

  cache.write(GRID_KEY, JSON.stringify(entry(width)));

  return cache;
};

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  window.localStorage.clear();
});

describe("the settings gate", () => {
  it("holds the app back until an account's settings have settled", async () => {
    const state = createSettingsMockState({ ...ACCOUNT });

    renderGate(state);

    expect(screen.getByText("Loading settings…")).toBeInTheDocument();

    /*
     * The density's very first value is the account's, not the contract's
     * default — which is the whole reason a round trip is paid before anything
     * renders. `GridDensityProvider` seeds from `adopted` on the render it
     * mounts, so a gate that opened early would show Comfortable once and then
     * correct itself, on every load, for somebody who chose Compact.
     */
    expect(await screen.findByTestId("density")).toHaveTextContent("compact");
    // And no grid adapter is mounted where no seam was passed.
    expect(screen.getByTestId("width")).toHaveTextContent("auto");
  });

  it("gives the i18n slot the account's language on the first render it gets", async () => {
    const adoptedLocales: (Locale | undefined)[] = [];

    renderGate(createSettingsMockState({ ...ACCOUNT }), { adoptedLocales });

    await screen.findByTestId("locale");

    /*
     * ADR-0046 §4 puts the account ahead of the device, and that ordering is
     * only real below this gate: an app's provider builds its instance once,
     * from the locale it is first handed, so an `undefined` here followed by
     * `lv` would be a language *change* rather than the answer.
     */
    expect(adoptedLocales.length).toBeGreaterThan(0);
    expect(new Set(adoptedLocales)).toEqual(new Set(["lv"]));
  });

  it("adopts the account's theme, and mirrors it to the device", async () => {
    renderGate(createSettingsMockState({ ...ACCOUNT }));

    expect(await screen.findByTestId("theme")).toHaveTextContent("dark");
    expect(document.documentElement).toHaveClass("dark");
    // The device cache is written too, so the next first paint is right before
    // any session exists to ask — under the prefix the theme slot was bound
    // with, which is the app's to choose (ADR-0064 §1).
    expect(window.localStorage.getItem(THEME_KEY)).toBe("dark");
  });

  it("renders immediately for an anonymous visitor, and asks for nothing", async () => {
    const state = createSettingsMockState({ ...ACCOUNT });

    renderGate(state, { anonymous: true });

    expect(screen.queryByText("Loading settings…")).not.toBeInTheDocument();
    expect(screen.getByTestId("density")).toHaveTextContent("comfortable");

    await waitFor(() => {
      expect(state.seen.patches).toEqual([]);
    });
    // Not merely "no write": an anonymous visitor must not *ask*, because the
    // request would 401 and start a refresh for a session that does not exist.
    expect(state.seen.reads).toBe(0);
  });

  it("goes back to the device alone when the session ends in this tab", async () => {
    const user = userEvent.setup();
    const state = createSettingsMockState({ ...ACCOUNT });

    const { store } = renderGate(state);

    expect(await screen.findByTestId("theme")).toHaveTextContent("dark");

    /*
     * Signing out disables the query but does not evict what it cached, and
     * `staleTime: Infinity` means it is never refetched. The signed-out app is
     * the device alone, so this must not be decided by what happens to be in
     * the cache.
     */
    act(() => {
      store.clear();
    });

    // A toggle on the sign-in screen writes the device and speaks to nobody.
    await user.click(screen.getByRole("button", { name: "Light" }));

    expect(window.localStorage.getItem(THEME_KEY)).toBe("light");
    await new Promise((resolve) => {
      setTimeout(resolve, SETTINGS_WRITE_DEBOUNCE_MS + 250);
    });
    expect(state.seen.patches).toEqual([]);
  });

  it("degrades to the device when the read fails", async () => {
    const state = createSettingsMockState({ ...ACCOUNT });
    state.failWith = { status: 500, code: "INTERNAL_ERROR" };

    renderGate(state);

    /*
     * The app a person had before they signed in: the contract's default
     * density and the device's theme, rather than a screen that will not open.
     * A failed read is not a gate failure.
     */
    expect(await screen.findByTestId("density")).toHaveTextContent(
      "comfortable",
    );
    expect(screen.getByTestId("theme")).not.toHaveTextContent("dark");
    expect(state.seen.reads).toBe(1);
  });
});

describe("what a chosen preference does to the account", () => {
  it("writes the theme through the coalescing writer", async () => {
    const user = userEvent.setup();
    const state = createSettingsMockState({ ...ACCOUNT });

    renderGate(state);

    await user.click(await screen.findByRole("button", { name: "Light" }));

    expect(window.localStorage.getItem(THEME_KEY)).toBe("light");
    expect(document.documentElement).not.toHaveClass("dark");

    // The account half is debounced, so it arrives after the window rather
    // than with the click.
    await waitFor(
      () => {
        expect(state.seen.patches).toEqual([{ theme: "light" }]);
      },
      { timeout: 5_000 },
    );
    expect(state.settings.theme).toBe("light");
  });

  it("collapses a theme and a density chosen together into one PATCH", async () => {
    const user = userEvent.setup();
    const state = createSettingsMockState({
      ...ACCOUNT,
      gridDensity: "comfortable",
    });

    renderGate(state);

    await screen.findByTestId("theme");

    /*
     * Appearance and density are two cards on one section, clicked in the same
     * breath by somebody setting the app up. Two clicks inside the window are
     * one body carrying both keys — and the body carries *only* what changed,
     * which is what makes sending a partial patch safe under ADR-0045's
     * per-key merge.
     */
    await user.click(screen.getByRole("button", { name: "Light" }));
    await user.click(screen.getByRole("button", { name: "Compact" }));

    await waitFor(
      () => {
        expect(state.seen.patches).toEqual([
          { theme: "light", gridDensity: "compact" },
        ]);
      },
      { timeout: 5_000 },
    );
  });

  it("sends a chosen language straight through, without waiting for the window", async () => {
    const user = userEvent.setup();
    const state = createSettingsMockState({ ...ACCOUNT, locale: "en" });

    renderGate(state);

    expect(await screen.findByTestId("locale")).toHaveTextContent("en");

    await user.click(screen.getByRole("button", { name: "Latvian" }));

    /*
     * ADR-0046 §4's own path, and the timeout is the claim: a language is
     * chosen once, deliberately, by somebody who walked to a settings page to
     * do it, so there is nothing to coalesce and a second of debounce would be
     * a second of not knowing. Bounded *under* the writer's window, so a locale
     * quietly moved onto the writer would fail here rather than pass late.
     */
    await waitFor(
      () => {
        expect(state.seen.patches).toEqual([{ locale: "lv" }]);
      },
      { timeout: SETTINGS_WRITE_DEBOUNCE_MS - 400 },
    );
    expect(state.settings.locale).toBe("lv");
  });

  it("keeps the choice rather than springing back", async () => {
    const user = userEvent.setup();
    const state = createSettingsMockState({ ...ACCOUNT });

    renderGate(state);

    await user.click(await screen.findByRole("button", { name: "Light" }));

    await waitFor(
      () => {
        expect(state.seen.patches).toHaveLength(1);
      },
      { timeout: 5_000 },
    );

    // The response re-seeds the cache entry and the adoption latch sees a new
    // value; what it must not do is re-apply the theme the account held a
    // second ago.
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
  });

  it("keeps what was chosen when the write is refused", async () => {
    const user = userEvent.setup();
    const state = createSettingsMockState({ ...ACCOUNT });

    renderGate(state);
    await screen.findByTestId("theme");

    // The read has landed and will not be repeated; only the flush can fail
    // from here.
    state.failWith = { status: 503, code: "SERVICE_UNAVAILABLE" };

    await user.click(screen.getByRole("button", { name: "Light" }));

    await waitFor(
      () => {
        expect(state.seen.refused).toEqual([{ theme: "light" }]);
      },
      { timeout: 5_000 },
    );

    /*
     * "Not persisting", never "reverted": the providers own what is displayed
     * and the writer owns only what it is about to send, so a refused flush
     * leaves the app in the theme that was picked. What a person is *told* is
     * the app's query client's to say (ADR-0043), and each door asserts it.
     */
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(document.documentElement).not.toHaveClass("dark");
    expect(state.settings.theme).toBe("dark");
  });
});

describe("the settings gate over a grid seam", () => {
  it("makes a grid's first read the account's arrangement", async () => {
    const state = createSettingsMockState({
      ...ACCOUNT,
      grids: { staff: entry(360) },
    });

    renderGate(state, { cache: deviceWith(140) });

    expect(screen.getByText("Loading settings…")).toBeInTheDocument();

    // The grid's very first read is the account's, not the device's — which is
    // the whole reason one round trip is paid before anything renders.
    expect(await screen.findByTestId("width")).toHaveTextContent("360");
  });

  it("hands an anonymous visitor the device cache itself, and asks for nothing", async () => {
    const state = createSettingsMockState();

    // Signed out, the device is the only owner there is, and the app is what
    // it was before ADR-0045.
    renderGate(state, { anonymous: true, cache: deviceWith(140) });

    expect(screen.getByTestId("width")).toHaveTextContent("140");
    expect(screen.queryByText("Loading settings…")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(state.seen.patches).toEqual([]);
    });
    expect(state.seen.reads).toBe(0);
  });

  it("goes back to the device's arrangement when the session ends in this tab", async () => {
    const state = createSettingsMockState({
      ...ACCOUNT,
      grids: { staff: entry(360) },
    });

    // The arrangement this device has, which is not the account's.
    const { store } = renderGate(state, { cache: deviceWith(140) });

    expect(await screen.findByTestId("width")).toHaveTextContent("360");

    // The query still holds the row of whoever just left; the adapter in
    // context must not (ADR-0045 §The server adapter).
    act(() => {
      store.clear();
    });

    expect(screen.getByTestId("width")).toHaveTextContent("140");
  });

  it("adopts a device-only arrangement and hands it to the next client", async () => {
    const state = createSettingsMockState();

    // The arrangement somebody built before this API existed.
    const { unmount } = renderGate(state, { cache: deviceWith(500) });

    expect(await screen.findByTestId("width")).toHaveTextContent("500");

    await waitFor(
      () => {
        expect(state.settings.grids["staff"]).toEqual(entry(500));
      },
      { timeout: 5_000 },
    );
    expect(state.seen.patches).toEqual([{ grids: { staff: entry(500) } }]);

    unmount();

    // A second browser: same account, nothing in its device cache.
    renderGate(state, { cache: createMemoryCache() });

    expect(await screen.findByTestId("width")).toHaveTextContent("500");
  });
});
