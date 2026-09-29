import { GridDensityProvider } from "@repo/app-services";
import { GRID_DENSITIES, type GridDensity } from "@repo/contracts";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createGridDensityCards } from "../preferences/density-cards";

import {
  OptionsControl,
  createI18nSlot,
  createTestI18n,
  renderAccount,
} from "./support/render";

/**
 * The density mode as the Preferences section lists it, certified where the
 * card lives (`D22.2`, ADR-0077 §4; ADR-0053 §2, ADR-0054 §6).
 *
 * **What moved here is the card's own half of the admin door's suite**: the
 * options are the contracts tuple, the group is named, and the mode in force
 * is the one marked. The admin asked that through its settings gate over MSW;
 * here the account's answer arrives the way the gate delivers it, as
 * `GridDensityProvider`'s `adopted`, because the card reads the provider and
 * cannot tell what is above it.
 *
 * What stayed at the door is everything about requests — the `PATCH` body,
 * the coalescing with a theme change — and the band toggle, which is the
 * admin's alone. What this card owes any of that is one `publish` call with
 * the enum member, and that is asked here with a spy in the writer's seat.
 */
const GridDensityCards = createGridDensityCards(OptionsControl);

const card = (name: string) => screen.getByRole("radio", { name });

/**
 * The card under a density provider of the test's own, which is how the
 * settings gate mounts it: with the account's answer and somewhere to publish.
 */
const renderUnderGate = (slot: {
  readonly adopted?: GridDensity;
  readonly publish?: (density: GridDensity) => void;
}) => {
  const user = userEvent.setup();
  const I18nSlot = createI18nSlot(createTestI18n());

  renderAccount(
    <GridDensityProvider adopted={slot.adopted} publish={slot.publish}>
      <I18nSlot>
        <GridDensityCards />
      </I18nSlot>
    </GridDensityProvider>,
    { preferences: false },
  );

  return user;
};

describe("the density cards", () => {
  it("offers exactly the modes the contract declares, and marks the account's", () => {
    renderUnderGate({ adopted: "compact" });

    const options = screen.getAllByRole("radio");

    expect(options).toHaveLength(GRID_DENSITIES.length);
    expect(
      options.map((option) => option.closest("label")?.textContent),
    ).toEqual(["Comfortable", "Compact"]);
    expect(options.map((option) => option.getAttribute("value"))).toEqual([
      ...GRID_DENSITIES,
    ]);
    expect(card("Compact")).toBeChecked();
    expect(card("Comfortable")).not.toBeChecked();
    expect(screen.getByRole("group", { name: "Rows" })).toBeInTheDocument();
  });

  it("marks the contract's default when no account has answered", () => {
    renderAccount(<GridDensityCards />);

    expect(card("Comfortable")).toBeChecked();
    expect(card("Compact")).not.toBeChecked();
  });

  it("changes the mode and marks the choice, with no account to write to", async () => {
    const user = userEvent.setup();

    renderAccount(<GridDensityCards />);

    await user.click(card("Compact"));

    // Immediately and without a round trip: the state is the provider's, and
    // the harness's provider has no `publish` at all.
    expect(card("Compact")).toBeChecked();
    expect(card("Comfortable")).not.toBeChecked();
  });

  it("hands the choice to the writer when one is installed", async () => {
    const publish = vi.fn<(density: GridDensity) => void>();
    const user = renderUnderGate({ publish });

    await user.click(card("Compact"));

    /*
     * Once, and with the enum member: ADR-0045's coalescing writer is handed
     * the contract's value, and whether it becomes one `PATCH` or part of one
     * is the writer's to decide.
     */
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith("compact");
    expect(card("Compact")).toBeChecked();
  });

  it("takes its words from the catalogue, in the language the app speaks", () => {
    renderAccount(<GridDensityCards />, { locale: "lv" });

    expect(screen.getByRole("group", { name: "Rindas" })).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("radio")
        .map((option) => option.closest("label")?.textContent),
    ).toEqual(["Ērtas", "Kompaktas"]);
  });
});
