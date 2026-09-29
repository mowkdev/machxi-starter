import { GRID_DENSITIES } from "@repo/contracts";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { GridDensityCards } from "@/features/density";
import { renderWithProviders } from "@/test/render";

/**
 * The density door's binding (`D22.2`, ADR-0077 §4; ADR-0053 §2, ADR-0054
 * §6).
 *
 * **One smoke case, because the card set is `@repo/account`'s and is certified
 * there**, in the package's `density-cards.test.tsx`. What the package cannot
 * ask is the one thing this slice does: hand the cards `@repo/app-kit`'s real
 * `SettingsOptions`, under this app's density provider.
 *
 * This app has no band and no toggle (ADR-0055 §3), so the cards are the
 * mode's only surface here and there is no second control to agree with.
 */
describe("the density door", () => {
  it("draws the package's cards with the kit's control", async () => {
    const user = userEvent.setup();

    renderWithProviders(<GridDensityCards />);

    expect(screen.getByRole("group", { name: "Rows" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(GRID_DENSITIES.length);
    expect(screen.getByRole("radio", { name: "Comfortable" })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: "Compact" }));

    expect(screen.getByRole("radio", { name: "Compact" })).toBeChecked();
  });
});
