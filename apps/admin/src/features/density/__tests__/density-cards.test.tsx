import { GRID_DENSITIES } from "@repo/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { SettingsProvider } from "@/app/providers/settings";
import { GridDensityCards, GridDensityControl } from "@/features/density";
import { useTheme } from "@/shared/theme";
import {
  createSettingsHandlers,
  createSettingsMockState,
  type SettingsMockState,
} from "@/test/msw/handlers/settings.handlers";
import { server } from "@repo/app-kit/testing";
import { authenticatedAs } from "@/test/principals";
import { renderWithProviders } from "@/test/render";

/**
 * The density door's binding, and the wiring behind it (`D22.2`, ADR-0077 §4;
 * ADR-0053 §2, ADR-0054 §6).
 *
 * **The card set is `@repo/account`'s and is certified there**: that the
 * options are the contracts tuple, that the group is named, that the mode in
 * force is the one marked and that a choice is handed to a writer are the
 * package's `density-cards.test.tsx`. What remains here is what the package
 * cannot ask.
 *
 * The **smoke case** is the one thing this slice does — hand the cards
 * `@repo/app-kit`'s real `SettingsOptions` — and it is asked under the real
 * settings gate, so the mode it finds marked is the account's.
 *
 * The **wiring cases** are `D11.6`'s claims made from this surface: a click
 * writes the mode back through ADR-0045's coalescing writer, and a click
 * beside a theme change is *one* `PATCH`. The real `SettingsProvider` is
 * mounted and MSW answers `/settings` with the schema the API validates with,
 * because a mock kinder than the server would certify the opposite of
 * production (ADR-0036).
 *
 * The last case is the one only this app can make: **the two surfaces are one
 * fact**. ADR-0053 §2's one-inventory rule tolerates the grid band's toggle
 * beside the section's cards because a working control next to the thing it
 * changes is not an inventory — and the thing that makes that tolerable
 * rather than a double entry is that neither can disagree with the other. The
 * toggle is the admin's alone, so the case is too.
 */

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

const renderCards = (state: SettingsMockState) => {
  server.use(...createSettingsHandlers(state));

  return renderWithProviders(
    <SettingsProvider fallback={<p>Loading settings…</p>}>
      <GridDensityCards />
      <GridDensityControl />
      <ThemeProbe />
    </SettingsProvider>,
    { store: authenticatedAs() },
  );
};

const card = (name: string) => screen.getByRole("radio", { name });

beforeEach(() => {
  window.localStorage.clear();
});

describe("the density door", () => {
  it("draws the package's cards with the kit's control, marking the account's mode", async () => {
    renderCards(
      createSettingsMockState({
        theme: "system",
        locale: "en",
        gridDensity: "compact",
        grids: {},
      }),
    );

    await waitFor(() => {
      expect(card("Compact")).toBeChecked();
    });
    expect(screen.getAllByRole("radio")).toHaveLength(GRID_DENSITIES.length);
    expect(card("Comfortable")).not.toBeChecked();
    expect(screen.getByRole("group", { name: "Rows" })).toBeInTheDocument();
  });

  it("writes the mode to the account, and only the mode", async () => {
    const user = userEvent.setup();
    const state = createSettingsMockState();

    renderCards(state);

    await waitFor(() => {
      expect(card("Comfortable")).toBeChecked();
    });

    await user.click(card("Compact"));

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

    renderCards(state);

    await waitFor(() => {
      expect(card("Comfortable")).toBeChecked();
    });

    await user.click(card("Compact"));
    await user.click(screen.getByRole("button", { name: "Dark" }));

    // The same body the band's toggle produces, which is the whole reason both
    // surfaces go through the coalescing writer rather than one of them
    // reaching for the mutation directly.
    await waitFor(
      () => {
        expect(state.seen.patches).toEqual([
          { theme: "dark", gridDensity: "compact" },
        ]);
      },
      { timeout: 4_000 },
    );
  });

  it("moves with the band's toggle, because it is the same fact", async () => {
    const user = userEvent.setup();
    const state = createSettingsMockState();

    renderCards(state);

    const toggle = () => screen.getByRole("button", { name: "Compact rows" });

    await waitFor(() => {
      expect(toggle()).toHaveAttribute("aria-pressed", "false");
    });

    await user.click(card("Compact"));

    // Immediately, and without a round trip: the state is the provider's, so
    // an operator who compacts the rows from the section finds the grid's own
    // control already saying so.
    expect(toggle()).toHaveAttribute("aria-pressed", "true");

    await user.click(toggle());

    expect(card("Comfortable")).toBeChecked();
  });
});
