import type { GridPreferencesV1 } from "@repo/contracts";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SettingsProvider } from "@/app/providers/settings";
import { SETTINGS_WRITE_DEBOUNCE_MS } from "@/entities/settings";
import { gridStorageKey } from "@/shared/grid/preferences";
import { useGridPreferences } from "@/shared/grid/use-grid-preferences";
import { useTheme } from "@/shared/theme";
import { authenticatedAs } from "@/test/principals";
import { renderWithProviders } from "@/test/render";
import {
  createSettingsHandlers,
  createSettingsMockState,
  type SettingsMockState,
} from "@/test/msw/handlers/settings.handlers";
import { server } from "@/test/msw/server";
import { createSessionStore } from "@/shared/api/session-store";

/**
 * The account's settings, adopted by the app (`D6.3`, ADR-0045 §The client).
 *
 * Three claims, and each of them is about *ordering* rather than markup:
 *
 * 1. Nothing below renders until an authenticated principal's settings have
 *    settled, because ADR-0041's `read` is synchronous and a grid that mounted
 *    first would read the device and never hear about the account.
 * 2. The theme the account holds is applied when it arrives, and a toggle after
 *    that writes both the device cache and the account.
 * 3. Anonymous — before a sign-in, after a sign-out, or after a failed read —
 *    the app is exactly what it was before this deliverable: `localStorage`
 *    behind the seam, and no toast. Signed out is decided by the *session*,
 *    not by whether the disabled query still holds the last principal's row.
 *
 * The provider is rendered directly, with its dependencies passed, for the
 * reason `session-provider.test.tsx` renders that one directly: the module's
 * singletons are the app's, and a test that reached them would be asserting
 * about a session no component here uses.
 */

const DEFAULTS = { order: ["email", "status"] } as const;

const entry = (width: number): GridPreferencesV1 => ({
  v: 1,
  sizing: { email: width },
  order: ["email", "status"],
  hidden: [],
});

/** Reads what a grid *would* read, through whatever adapter is in context. */
const GridProbe = () => {
  const [preferences] = useGridPreferences({
    gridId: "staff",
    movable: DEFAULTS.order,
    storage: undefined,
  });

  return (
    <output data-testid="width">{preferences.sizing.email ?? "auto"}</output>
  );
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

const renderProvider = (
  state: SettingsMockState,
  { anonymous = false }: { anonymous?: boolean } = {},
) => {
  server.use(...createSettingsHandlers(state));

  return renderWithProviders(
    <SettingsProvider fallback={<p>Loading settings…</p>}>
      <GridProbe />
      <ThemeProbe />
    </SettingsProvider>,
    { store: anonymous ? createSessionStore() : authenticatedAs() },
  );
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
    const state = createSettingsMockState({
      theme: "system",
      locale: "en",
      gridDensity: "comfortable",
      grids: { staff: entry(360) },
    });

    renderProvider(state);

    expect(screen.getByText("Loading settings…")).toBeInTheDocument();

    // The grid's very first read is the account's, not the device's — which is
    // the whole reason one round trip is paid before anything renders.
    expect(await screen.findByTestId("width")).toHaveTextContent("360");
  });

  it("renders immediately for an anonymous visitor, and asks for nothing", async () => {
    const state = createSettingsMockState();

    // `machxi.admin.grid:staff:v1` as a device-local entry: signed out, this is
    // the only owner there is, and the app is what it was before ADR-0045.
    window.localStorage.setItem(
      gridStorageKey("staff"),
      JSON.stringify(entry(140)),
    );

    renderProvider(state, { anonymous: true });

    expect(screen.getByTestId("width")).toHaveTextContent("140");
    expect(screen.queryByText("Loading settings…")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(state.seen.patches).toEqual([]);
    });
    // Not merely "no write": an anonymous visitor must not *ask*, because the
    // request would 401 and start a refresh for a session that does not exist.
    expect(state.seen.reads).toBe(0);
  });

  it("goes back to the device alone when the session ends in this tab", async () => {
    const user = userEvent.setup();
    const state = createSettingsMockState({
      theme: "dark",
      locale: "en",
      gridDensity: "comfortable",
      grids: { staff: entry(360) },
    });

    // The arrangement this device has, which is not the account's.
    window.localStorage.setItem(
      gridStorageKey("staff"),
      JSON.stringify(entry(140)),
    );

    const { store } = renderProvider(state);

    expect(await screen.findByTestId("width")).toHaveTextContent("360");

    // Logging out disables the query but does not evict what it cached, and
    // `staleTime: Infinity` means it is never refetched. The signed-out app is
    // still the local adapter alone (ADR-0045 §The server adapter), so this
    // must not be decided by what happens to be in the cache.
    act(() => {
      store.clear();
    });

    expect(screen.getByTestId("width")).toHaveTextContent("140");

    // And no publisher either: a toggle on the login screen writes the device
    // and speaks to nobody.
    await user.click(screen.getByRole("button", { name: "Light" }));

    expect(window.localStorage.getItem("machxi.admin.theme")).toBe("light");
    await new Promise((resolve) => {
      setTimeout(resolve, SETTINGS_WRITE_DEBOUNCE_MS + 250);
    });
    expect(state.seen.patches).toEqual([]);
  });

  it("degrades to the device when the read fails, without a toast", async () => {
    const state = createSettingsMockState();
    state.failWith = { status: 500, code: "INTERNAL_ERROR" };

    window.localStorage.setItem(
      gridStorageKey("staff"),
      JSON.stringify(entry(220)),
    );

    renderProvider(state);

    expect(await screen.findByTestId("width")).toHaveTextContent("220");
    // A settings read that fails is not an outcome an operator can act on; the
    // one toast this resource declares is a *write's* (ADR-0045).
    expect(document.querySelector("[data-sonner-toast]")).toBeNull();
  });
});

describe("the theme as an account fact", () => {
  it("adopts the account's theme when the query resolves", async () => {
    renderProvider(
      createSettingsMockState({
        theme: "dark",
        locale: "en",
        gridDensity: "comfortable",
        grids: {},
      }),
    );

    expect(await screen.findByTestId("theme")).toHaveTextContent("dark");
    expect(document.documentElement).toHaveClass("dark");
    // The device cache is written too, so the next first paint is right before
    // any session exists to ask.
    expect(window.localStorage.getItem("machxi.admin.theme")).toBe("dark");
  });

  it("writes both the device and the account on a toggle", async () => {
    const user = userEvent.setup();
    const state = createSettingsMockState({
      theme: "dark",
      locale: "en",
      gridDensity: "comfortable",
      grids: {},
    });

    renderProvider(state);

    await user.click(await screen.findByRole("button", { name: "Light" }));

    expect(window.localStorage.getItem("machxi.admin.theme")).toBe("light");
    expect(document.documentElement).not.toHaveClass("dark");

    // The account half is debounced and coalesced, so it arrives after the
    // window rather than with the click.
    await waitFor(
      () => {
        expect(state.seen.patches).toEqual([{ theme: "light" }]);
      },
      { timeout: 5_000 },
    );
    expect(state.settings.theme).toBe("light");
  });

  it("degrades to `not persisting` when the write is refused", async () => {
    const user = userEvent.setup();
    const state = createSettingsMockState({
      theme: "dark",
      locale: "en",
      gridDensity: "comfortable",
      grids: {},
    });

    renderProvider(state);
    await screen.findByTestId("theme");

    // The read has landed and will not be repeated; only the flush can fail
    // from here.
    state.failWith = { status: 503, code: "SERVICE_UNAVAILABLE" };

    await user.click(screen.getByRole("button", { name: "Light" }));

    // The operator hears about it once, from the global mutation handler
    // (ADR-0043) — and what they chose is still what they are looking at.
    await waitFor(
      () => {
        expect(document.querySelector("[data-sonner-toast]")).not.toBeNull();
      },
      { timeout: 5_000 },
    );
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(document.documentElement).not.toHaveClass("dark");
  });

  it("keeps the operator's choice rather than springing back", async () => {
    const user = userEvent.setup();
    const state = createSettingsMockState({
      theme: "dark",
      locale: "en",
      gridDensity: "comfortable",
      grids: {},
    });

    renderProvider(state);

    await user.click(await screen.findByRole("button", { name: "Light" }));

    await waitFor(
      () => {
        expect(state.seen.patches).toHaveLength(1);
      },
      { timeout: 5_000 },
    );

    // The response re-seeds the mirror and the adoption latch sees a new value;
    // what it must not do is re-apply the theme the account held a second ago.
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
  });
});

describe("one account, two browsers", () => {
  it("adopts a device-only arrangement and hands it to the next client", async () => {
    const state = createSettingsMockState();

    // The arrangement an operator built before this API existed.
    window.localStorage.setItem(
      gridStorageKey("staff"),
      JSON.stringify(entry(500)),
    );

    const { unmount } = renderProvider(state);

    expect(await screen.findByTestId("width")).toHaveTextContent("500");

    await waitFor(
      () => {
        expect(state.settings.grids["staff"]).toEqual(entry(500));
      },
      { timeout: 5_000 },
    );

    unmount();

    // A second browser: same account, nothing in its `localStorage`.
    window.localStorage.clear();
    renderProvider(state);

    expect(await screen.findByTestId("width")).toHaveTextContent("500");
  });
});
