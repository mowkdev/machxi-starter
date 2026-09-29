import { THEMES, type Theme } from "@repo/contracts";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createThemeCards } from "../preferences/theme-cards";

import {
  DEVICE_KEY_PREFIX,
  OptionsControl,
  ThemeSlot,
  createI18nSlot,
  createTestI18n,
  renderAccount,
} from "./support/render";

/**
 * Choosing how the app is painted, certified where the card lives (`D22.2`,
 * ADR-0077 §4; ADR-0045 §Theme, ADR-0053 §2).
 *
 * **The admin door's suite, moved with the code and with no claim weakened.**
 * Every case was written against roles and accessible names (ADR-0036), so the
 * only edits the move needed are the two values an app binds: the options
 * control, which is the harness's stand-in of the same contract with a screen
 * reader, and the device-key prefix, which is the harness's rather than
 * `machxi.admin`. Each app's door keeps one smoke case proving its binding
 * with the kit's real control.
 *
 * The account half is asked here of the card alone, which the app suites
 * could not do: `useTheme().setTheme` hands the choice to a `publish` it never
 * sees, so a spy in that seat is the whole of what this card owes an account.
 * What the settings gate does with it — the coalescing writer, the `PATCH` —
 * is the gate's suite's to say.
 */
const ThemeCards = createThemeCards(OptionsControl);

const THEME_KEY = `${DEVICE_KEY_PREFIX}.theme`;

const render = () => {
  const user = userEvent.setup();

  renderAccount(<ThemeCards />);

  return user;
};

/**
 * The card under a theme provider of the test's own, which is how the settings
 * gate mounts it: with the account's answer and somewhere to publish to.
 */
const renderUnderGate = (slot: {
  readonly adopted?: Theme;
  readonly publish?: (theme: Theme) => void;
}) => {
  const user = userEvent.setup();
  const I18nSlot = createI18nSlot(createTestI18n());

  renderAccount(
    <ThemeSlot adopted={slot.adopted} publish={slot.publish}>
      <I18nSlot>
        <ThemeCards />
      </I18nSlot>
    </ThemeSlot>,
    { preferences: false },
  );

  return user;
};

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("the appearance control", () => {
  it("offers exactly the themes the contract declares", () => {
    render();

    const options = screen.getAllByRole("radio");

    expect(options).toHaveLength(THEMES.length);
    expect(
      options.map((option) => option.closest("label")?.textContent),
    ).toEqual(["Light", "Dark", "System"]);
    expect(options.map((option) => option.getAttribute("value"))).toEqual([
      ...THEMES,
    ]);
  });

  it("is one named group, not three loose controls", () => {
    render();

    /*
     * The group and its name. Three radios sharing a `name` are already
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
    expect(window.localStorage.getItem(THEME_KEY)).toBe("dark");
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
    expect(window.localStorage.getItem(THEME_KEY)).toBe("system");
  });

  it("takes its words from the catalogue, in the language the app speaks", () => {
    renderAccount(<ThemeCards />, { locale: "lv" });

    expect(screen.getByRole("group", { name: "Izskats" })).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("radio")
        .map((option) => option.closest("label")?.textContent),
    ).toEqual(["Gaišs", "Tumšs", "Sistēmas"]);
  });

  it("marks the account's theme once the gate has adopted it", async () => {
    renderUnderGate({ adopted: "dark" });

    expect(await screen.findByRole("radio", { name: "Dark" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "System" })).not.toBeChecked();
  });

  it("hands the choice to the publisher when one is installed, and still writes the device", async () => {
    const publish = vi.fn<(theme: Theme) => void>();
    const user = renderUnderGate({ publish });

    await user.click(screen.getByRole("radio", { name: "Dark" }));

    /*
     * Once, and with the enum member: what the gate's coalescing writer is
     * handed is the contract's value, never the label a person clicked.
     */
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith("dark");
    expect(window.localStorage.getItem(THEME_KEY)).toBe("dark");
  });
});
