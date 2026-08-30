import { THEMES } from "@repo/contracts";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ThemeCards } from "@/features/theme";
import { renderWithProviders } from "@/test/render";

/**
 * Choosing how the panel is painted (`D6.3`, moved to the page at `D11.10`;
 * ADR-0045 §Theme, ADR-0053 §2).
 *
 * **This file is `theme-menu-items.test.tsx` with the surface swapped and no
 * claim weakened**, which is the point of asserting a control by role and
 * accessible name (ADR-0036): every case below made the same claim about the
 * menu, and the move from `menuitemradio` to `radio` is the only edit any of
 * them needed. A control an operator can only find by looking is one a screen
 * reader cannot announce, and "one of three" is a radio group rather than
 * three buttons for exactly that reason — in a dropdown and on a page alike.
 *
 * The account half is not asserted here. This slice cannot tell whether there
 * is one — `useTheme().setTheme` writes the device and hands the rest to a
 * `publish` it never sees — and that is the property being relied on, so the
 * write-through is asserted where it is wired, in `settings-provider.test.tsx`.
 */
const render = () => {
  const user = userEvent.setup();

  renderWithProviders(<ThemeCards />);

  return user;
};

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  window.localStorage.clear();
});

describe("the appearance control", () => {
  it("offers exactly the themes the contract declares", () => {
    render();

    const options = screen.getAllByRole("radio");

    expect(options).toHaveLength(THEMES.length);
    expect(
      options.map((option) => option.closest("label")?.textContent),
    ).toEqual(["Light", "Dark", "System"]);
  });

  it("is one named group, not three loose controls", () => {
    render();

    /*
     * The `<fieldset>` and its name. Three radios sharing a `name` are already
     * exclusive to the browser, but a screen reader reading them one at a time
     * would announce "Light, radio" with nothing saying what is being chosen —
     * the card's title is on screen above them and in the accessibility tree
     * only if something points at it.
     */
    expect(
      screen.getByRole("group", { name: "Appearance" }),
    ).toBeInTheDocument();
  });

  it("paints the panel and remembers the choice", async () => {
    const user = render();

    await user.click(screen.getByRole("radio", { name: "Dark" }));

    expect(document.documentElement).toHaveClass("dark");
    expect(window.localStorage.getItem("machxi.admin.theme")).toBe("dark");
  });

  it("marks the current choice, so the section says what is in force", async () => {
    const user = render();

    await user.click(screen.getByRole("radio", { name: "Dark" }));

    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Light" })).not.toBeChecked();
  });

  it("treats `system` as the media query rather than as a third palette", async () => {
    const user = render();

    await user.click(screen.getByRole("radio", { name: "Dark" }));
    await user.click(screen.getByRole("radio", { name: "System" }));

    // The harness's `matchMedia` answers "not dark" for everything, so this is
    // the resolution happening rather than the value being stored as a class.
    expect(document.documentElement).not.toHaveClass("dark");
    expect(window.localStorage.getItem("machxi.admin.theme")).toBe("system");
  });
});
