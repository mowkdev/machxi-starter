import type { GridPreferencesV1 } from "@repo/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SettingsProvider } from "@/app/providers/settings";
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
import { server } from "@repo/app-kit/testing";

/**
 * The settings gate, as this app binds it (`D22.2`, ADR-0077 §4; ADR-0045 §The
 * client).
 *
 * The gate is `@repo/account`'s, and what it does — the ordering, the
 * anonymous path, the writes — is certified in that package over stand-ins.
 * This is the door's suite, and it asks what only this app can:
 *
 * 1. **The binding.** The gate holds until the account's settings have
 *    settled and then hands them to this app's real providers: a grid reads
 *    the account's arrangement through the real grid door, and the theme is
 *    adopted under this app's device-key prefix.
 * 2. **The toast.** A failed read raises none and a refused write raises one,
 *    and both are the verdict of this app's query client (ADR-0043), which the
 *    package does not have.
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

const renderProvider = (state: SettingsMockState) => {
  server.use(...createSettingsHandlers(state));

  return renderWithProviders(
    <SettingsProvider fallback={<p>Loading settings…</p>}>
      <GridProbe />
      <ThemeProbe />
    </SettingsProvider>,
    { store: authenticatedAs() },
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

    // Under `waitFor`, not after `findByTestId` alone (D36.4): the probe
    // mounts once the gate opens, and the account's theme can land a render
    // after it, so the text, the class and the device write are retried
    // together until all three agree rather than read on the first paint.
    await screen.findByTestId("theme");
    await waitFor(() => {
      expect(screen.getByTestId("theme")).toHaveTextContent("dark");
      expect(document.documentElement).toHaveClass("dark");
      // The device cache is written too, so the next first paint is right
      // before any session exists to ask.
      expect(window.localStorage.getItem("machxi.admin.theme")).toBe("dark");
    });
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
});
