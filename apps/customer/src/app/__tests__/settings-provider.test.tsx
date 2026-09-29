import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SettingsProvider } from "@/app/providers/settings";
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
 * The settings gate, as this app binds it (`D22.2`, ADR-0077 §4; `D12.7`,
 * ADR-0045 §The client as carried by ADR-0053, ADR-0046 §4).
 *
 * The gate is `@repo/account`'s, and what it does — the ordering, the
 * anonymous path, the writes — is certified in that package over stand-ins.
 * This is the door's suite, and it asks what only this app can:
 *
 * 1. **The binding.** The gate holds until the account's settings have
 *    settled and then hands them to this app's real providers: the density
 *    seeds from the account, the i18next instance is **built** in the
 *    account's language by this app's own provider, and the theme is adopted
 *    under this app's device-key prefix.
 * 2. **The toast.** A failed read raises none and a refused write raises one,
 *    and both are the verdict of this app's query client (ADR-0043), which the
 *    package does not have.
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
  const { density } = useGridDensity();

  return <output data-testid="density">{density}</output>;
};

const LocaleProbe = () => {
  const { locale } = useLocale();

  return <output data-testid="locale">{locale}</output>;
};

const renderProvider = (state: SettingsMockState) => {
  server.use(...createSettingsHandlers(state));

  return renderWithProviders(
    <SettingsProvider fallback={<p>Loading settings…</p>}>
      <ThemeProbe />
      <DensityProbe />
      <LocaleProbe />
    </SettingsProvider>,
    { store: authenticated() },
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
