import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { SettingsProvider } from "@/app/providers/settings";
import { GridDensityControl } from "@/features/density";
import { useTheme } from "@/shared/theme";
import { useGridDensityValue } from "@/shared/density";
import {
  createSettingsHandlers,
  createSettingsMockState,
  type SettingsMockState,
} from "@/test/msw/handlers/settings.handlers";
import { server } from "@repo/app-kit/testing";
import { authenticatedAs } from "@/test/principals";
import { renderWithProviders } from "@/test/render";

/**
 * The density toggle, and the whole chain behind it (`D11.6`, ADR-0053 §2,
 * ADR-0054 §6).
 *
 * The control itself is four lines; what is worth asserting is that the fact
 * it changes is the **account's**, written the way ADR-0045 writes one. So the
 * real `SettingsProvider` is mounted and MSW answers `/settings` with the
 * schema the API validates with — a mock kinder than the server would certify
 * the opposite of production (ADR-0036).
 *
 * Three claims: the mode is adopted from the account on arrival, a click
 * writes it back through the coalescing writer, and a click beside a theme
 * change is *one* `PATCH` — which is the reason the density rides that writer
 * instead of going straight through `useUpdateSettings` the way the locale
 * does.
 */

const DensityProbe = () => (
  <output data-testid="density">{useGridDensityValue()}</output>
);

const ThemeProbe = () => {
  const { setTheme } = useTheme();

  return (
    <button
      onClick={() => {
        setTheme("dark");
      }}
      type="button"
    >
      Dark
    </button>
  );
};

const renderControl = (state: SettingsMockState) => {
  server.use(...createSettingsHandlers(state));

  return renderWithProviders(
    <SettingsProvider fallback={<p>Loading settings…</p>}>
      <GridDensityControl />
      <DensityProbe />
      <ThemeProbe />
    </SettingsProvider>,
    { store: authenticatedAs() },
  );
};

const toggle = () => screen.getByRole("button", { name: "Compact rows" });

beforeEach(() => {
  window.localStorage.clear();
});

describe("the grid density control", () => {
  it("shows the account's mode as its pressed state", async () => {
    renderControl(
      createSettingsMockState({
        theme: "system",
        locale: "en",
        gridDensity: "compact",
        grids: {},
      }),
    );

    // Pressed is Compact: the name says which state the button puts the app
    // in, and `aria-pressed` says whether it is already there — a control that
    // renamed itself on each click is one a screen-reader user cannot find
    // twice.
    await waitFor(() => {
      expect(toggle()).toHaveAttribute("aria-pressed", "true");
    });
    expect(screen.getByTestId("density")).toHaveTextContent("compact");
  });

  it("is drawn as the band's outlined 34, and counts its rules", async () => {
    renderControl(
      createSettingsMockState({
        theme: "system",
        locale: "en",
        gridDensity: "comfortable",
        grids: {},
      }),
    );

    /*
     * The treatment and the glyph, in the tier that gates (`D11.12`,
     * ADR-0054 §5). `test:e2e` measures the pair at 34x34 and bordered, but
     * it runs *beside* the gate, so without this a revert to `ghost` or to
     * `Rows3Icon` would pass `lint && check-types && test && size` in
     * silence — and the glyph is exactly what the review caught this step
     * getting wrong the first time.
     *
     * **The rule count is the assertion, not the icon's identity.** §5's
     * claim is that Comfortable draws three rules and Compact four; lucide
     * has no four-rule glyph (`Menu` and `AlignJustify` are the same three),
     * which is why the pair is drawn locally. Counting `path` elements is
     * the only thing that can hold that claim.
     */
    await waitFor(() => {
      expect(toggle()).toHaveClass("size-[34px]");
    });
    expect(toggle().querySelectorAll("svg path")).toHaveLength(3);

    await userEvent.setup().click(toggle());

    await waitFor(() => {
      expect(toggle().querySelectorAll("svg path")).toHaveLength(4);
    });
  });

  it("writes the mode to the account, and only the mode", async () => {
    const user = userEvent.setup();
    const state = createSettingsMockState();

    renderControl(state);

    await waitFor(() => {
      expect(toggle()).toHaveAttribute("aria-pressed", "false");
    });

    await user.click(toggle());

    // The grids see it immediately — the state is the provider's, not the
    // server's answer — and the account hears about it one debounce later.
    expect(screen.getByTestId("density")).toHaveTextContent("compact");

    await waitFor(
      () => {
        expect(state.seen.patches).toEqual([{ gridDensity: "compact" }]);
      },
      { timeout: 4_000 },
    );
    expect(state.settings.gridDensity).toBe("compact");
  });

  it("coalesces with a theme change into one patch", async () => {
    const user = userEvent.setup();
    const state = createSettingsMockState();

    renderControl(state);

    await waitFor(() => {
      expect(toggle()).toHaveAttribute("aria-pressed", "false");
    });

    await user.click(toggle());
    await user.click(screen.getByRole("button", { name: "Dark" }));

    // One body carrying both keys, which is the whole reason the density rides
    // ADR-0045's coalescing writer rather than going straight through the
    // mutation the locale uses: a toggle beside the grid is one click from a
    // column drag and from the theme.
    await waitFor(
      () => {
        expect(state.seen.patches).toEqual([
          { theme: "dark", gridDensity: "compact" },
        ]);
      },
      { timeout: 4_000 },
    );
  });
});
