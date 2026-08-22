import { THEMES } from "@repo/contracts";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ThemeMenuItems } from "@/features/theme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/shared/ui";
import { renderWithProviders } from "@/test/render";

/**
 * Choosing how the panel is painted (`D6.3`, ADR-0045 §Theme).
 *
 * Queried by role and accessible name throughout (ADR-0036): a theme control
 * an operator can only find by looking is one a screen reader cannot announce,
 * and "one of three" is a radio group rather than three buttons for exactly
 * that reason.
 *
 * The account half is not asserted here. This slice cannot tell whether there
 * is one — `useTheme().setTheme` writes the device and hands the rest to a
 * `publish` it never sees — and that is the property being relied on, so the
 * write-through is asserted where it is wired, in `settings-provider.test.tsx`.
 */
const renderMenu = () =>
  renderWithProviders(
    <DropdownMenu>
      <DropdownMenuTrigger>Account</DropdownMenuTrigger>
      <DropdownMenuContent>
        <ThemeMenuItems />
      </DropdownMenuContent>
    </DropdownMenu>,
  );

const open = async () => {
  const user = userEvent.setup();

  renderMenu();
  await user.click(screen.getByRole("button", { name: "Account" }));

  return user;
};

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  window.localStorage.clear();
});

describe("the appearance menu", () => {
  it("offers exactly the themes the contract declares", async () => {
    await open();

    const options = await screen.findAllByRole("menuitemradio");

    expect(options).toHaveLength(THEMES.length);
    expect(options.map((option) => option.textContent)).toEqual([
      "Light",
      "Dark",
      "System",
    ]);
  });

  it("paints the panel and remembers the choice", async () => {
    const user = await open();

    await user.click(
      await screen.findByRole("menuitemradio", { name: "Dark" }),
    );

    expect(document.documentElement).toHaveClass("dark");
    expect(window.localStorage.getItem("machxi.admin.theme")).toBe("dark");
  });

  it("marks the current choice, so the menu says what is in force", async () => {
    const user = await open();

    await user.click(
      await screen.findByRole("menuitemradio", { name: "Dark" }),
    );
    await user.click(screen.getByRole("button", { name: "Account" }));

    expect(
      await screen.findByRole("menuitemradio", { name: "Dark" }),
    ).toBeChecked();
  });

  it("treats `system` as the media query rather than as a third palette", async () => {
    const user = await open();

    await user.click(
      await screen.findByRole("menuitemradio", { name: "Dark" }),
    );
    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.click(
      await screen.findByRole("menuitemradio", { name: "System" }),
    );

    // The harness's `matchMedia` answers "not dark" for everything, so this is
    // the resolution happening rather than the value being stored as a class.
    expect(document.documentElement).not.toHaveClass("dark");
    expect(window.localStorage.getItem("machxi.admin.theme")).toBe("system");
  });
});
