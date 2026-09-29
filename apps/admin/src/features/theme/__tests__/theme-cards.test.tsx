import { THEMES } from "@repo/contracts";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ThemeCards } from "@/features/theme";
import { renderWithProviders } from "@/test/render";

/**
 * The appearance door's binding (`D22.2`, ADR-0077 §4; ADR-0045 §Theme,
 * ADR-0053 §2).
 *
 * **One smoke case, because the card is `@repo/account`'s and is certified
 * there.** The five cases this file held — the contract's options, the named
 * group, the paint and the device key, the marked choice, `system` as the
 * media query — moved with the code to the package's `theme-cards.test.tsx`,
 * none of them weakened. What the package cannot ask is the one thing this
 * slice does: hand the card `@repo/app-kit`'s real `SettingsOptions`, under
 * this app's theme provider and its device prefix.
 *
 * The account half is not asserted here. This slice cannot tell whether there
 * is one, and the write-through is asserted where it is wired, in
 * `settings-provider.test.tsx`.
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
    expect(window.localStorage.getItem("machxi.admin.theme")).toBe("dark");
  });
});
