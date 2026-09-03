import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SettingsProvider } from "@/app/providers/settings";
import { SETTINGS_WRITE_DEBOUNCE_MS } from "@/entities/settings";
import { createSessionStore } from "@/shared/api/session-store";
import { useGridDensity } from "@/shared/density";
import { useLocale } from "@/shared/i18n";
import { useTheme } from "@/shared/theme";
import {
  createSettingsHandlers,
  createSettingsMockState,
  type SettingsMockState,
} from "@/test/msw/handlers/settings.handlers";
import { server } from "@repo/app-kit/testing";
import { authenticated } from "@/test/principals";
import { renderWithProviders } from "@/test/render";

/**
 * The account's settings, adopted by the app (`D12.7`; ADR-0045 §The client as
 * carried by ADR-0053, ADR-0046 §4).
 *
 * Three claims, and each is about *ordering* rather than markup:
 *
 * 1. Nothing below renders until an authenticated customer's settings have
 *    settled. This app's reason is not the admin's — there a grid reads its
 *    storage synchronously at mount; here the i18next instance is **built** from
 *    a locale and the density provider **seeds** from one, so a value arriving
 *    after the first render is a language change and a re-render rather than the
 *    answer.
 * 2. What the account holds is what the app comes up in, and a change after that
 *    writes both what the device remembers and what the account does.
 * 3. Anonymous — before a sign-in, after a sign-out, or after a failed read —
 *    the app is the device alone, and no toast. Signed out is decided by the
 *    *session*, not by whether the disabled query still holds the last
 *    customer's row.
 *
 * The provider is rendered directly, with its dependencies passed, for the
 * reason `session-provider.test.tsx` renders that one directly: the module's
 * singletons are the app's, and a test that reached them would be asserting
 * about a session no component here uses.
 */

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

const renderProvider = (
  state: SettingsMockState,
  { anonymous = false }: { anonymous?: boolean } = {},
) => {
  server.use(...createSettingsHandlers(state));

  return renderWithProviders(
    <SettingsProvider fallback={<p>Loading settings…</p>}>
      <ThemeProbe />
      <DensityProbe />
      <LocaleProbe />
    </SettingsProvider>,
    { store: anonymous ? createSessionStore() : authenticated() },
  );
};

/** The account this app is asked to come up as, on every claim about adoption. */
const ACCOUNT = {
  theme: "dark",
  locale: "lv",
  gridDensity: "compact",
  grids: {},
} as const;

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

    renderProvider(state);

    expect(screen.getByText("Loading settings…")).toBeInTheDocument();

    /*
     * The density's very first value is the account's, not the contract's
     * default — which is the whole reason a round trip is paid before anything
     * renders. `GridDensityProvider` seeds from `adopted` on the render it
     * mounts, so a gate that opened early would show Comfortable once and then
     * correct itself, on every load, for a customer who chose Compact.
     */
    expect(await screen.findByTestId("density")).toHaveTextContent("compact");
  });

  it("comes up in the account's language rather than switching into it", async () => {
    renderProvider(createSettingsMockState({ ...ACCOUNT }));

    /*
     * ADR-0046 §4 puts the account ahead of the device, and that ordering is
     * only real below this gate: `createI18n` takes the locale at construction
     * and the instance is built once, so an account locale arriving later is a
     * language *change*. The probe reads the instance's own language, so this
     * is the instance having been built in `lv` rather than moved to it.
     */
    expect(await screen.findByTestId("locale")).toHaveTextContent("lv");
  });

  it("adopts the account's theme, and mirrors it to the device", async () => {
    renderProvider(createSettingsMockState({ ...ACCOUNT }));

    expect(await screen.findByTestId("theme")).toHaveTextContent("dark");
    expect(document.documentElement).toHaveClass("dark");
    /*
     * The device cache is written too, so the next first paint is right before
     * any session exists to ask. **The key reads `machxi.user.theme` since
     * `D14.7`** (ADR-0064 §1): it said `machxi.admin.theme` in an app that is
     * not the admin — D12's finding 1, pinned here so the day it was
     * parameterised would be a visible diff rather than a silent one, and this
     * is that diff. Two SPAs on one origin no longer share a theme.
     */
    expect(window.localStorage.getItem("machxi.user.theme")).toBe("dark");
  });

  it("renders immediately for an anonymous visitor, and asks for nothing", async () => {
    const state = createSettingsMockState({ ...ACCOUNT });

    renderProvider(state, { anonymous: true });

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

    const { store } = renderProvider(state);

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

    expect(window.localStorage.getItem("machxi.user.theme")).toBe("light");
    await new Promise((resolve) => {
      setTimeout(resolve, SETTINGS_WRITE_DEBOUNCE_MS + 250);
    });
    expect(state.seen.patches).toEqual([]);
  });

  it("degrades to the device when the read fails, without a toast", async () => {
    const state = createSettingsMockState({ ...ACCOUNT });
    state.failWith = { status: 500, code: "INTERNAL_ERROR" };

    renderProvider(state);

    /*
     * The app the customer had before they signed in: the contract's default
     * density and the device's theme, rather than a screen that will not open.
     */
    expect(await screen.findByTestId("density")).toHaveTextContent(
      "comfortable",
    );
    // A settings read that fails is not an outcome anybody can act on; the one
    // toast this resource declares is a *write's* (ADR-0043).
    expect(document.querySelector("[data-sonner-toast]")).toBeNull();
  });
});

describe("what a chosen preference does to the account", () => {
  it("writes the theme through the coalescing writer", async () => {
    const user = userEvent.setup();
    const state = createSettingsMockState({ ...ACCOUNT });

    renderProvider(state);

    await user.click(await screen.findByRole("button", { name: "Light" }));

    expect(window.localStorage.getItem("machxi.user.theme")).toBe("light");
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
    const state = createSettingsMockState({ ...ACCOUNT });

    renderProvider(state);

    await screen.findByTestId("theme");

    /*
     * The reason the writer is still here in an app with no grid to drag
     * (`entities/settings/settings.storage.ts`): appearance and density are two
     * cards on one section, clicked in the same breath by somebody setting the
     * app up. Two clicks inside the window are one body carrying both keys —
     * and the body carries *only* what changed, which is what makes sending a
     * partial patch safe under ADR-0045's per-key merge.
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

    renderProvider(state);

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

  it("keeps what the customer chose when the write is refused", async () => {
    const user = userEvent.setup();
    const state = createSettingsMockState({ ...ACCOUNT });

    renderProvider(state);
    await screen.findByTestId("theme");

    state.failWith = { status: 500, code: "INTERNAL_ERROR" };

    await user.click(screen.getByRole("button", { name: "Light" }));

    /*
     * "Not persisting", never "reverted": the providers own what is displayed
     * and the writer owns only what it is about to send, so a refused flush
     * leaves the app in the theme the customer picked. They hear about it once,
     * from the global mutation handler's toast (ADR-0043).
     */
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
