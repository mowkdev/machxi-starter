import { THEMES } from "@repo/contracts";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ThemeCards } from "@/features/theme";
import { DEVICE_KEY_PREFIX } from "@/shared/config";
import { renderWithProviders } from "@/test/render";

/**
 * The appearance door's binding (`D22.2`, ADR-0077 §4; ADR-0045 §Theme,
 * ADR-0053 §2).
 *
 * **One smoke case, because the card is `@repo/account`'s and is certified
 * there**, in the package's `theme-cards.test.tsx`. What the package cannot
 * ask is the one thing this slice does: hand the card `@repo/app-kit`'s real
 * `SettingsOptions`, under this app's theme provider and its device prefix —
 * which is the customer's own, so an operator's choice on the same origin is
 * not this person's (ADR-0064 §1).
 */
beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("the appearance door", () => {
  it("draws the package's card with the kit's control, under this app's device key", async () => {
    const user = userEvent.setup();

    renderWithProviders(<ThemeCards />);

    expect(
      screen.getByRole("group", { name: "Appearance" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(THEMES.length);

    await user.click(screen.getByRole("radio", { name: "Dark" }));

    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(window.localStorage.getItem(`${DEVICE_KEY_PREFIX}.theme`)).toBe(
      "dark",
    );
    expect(DEVICE_KEY_PREFIX).toBe("machxi.user");
  });
});
