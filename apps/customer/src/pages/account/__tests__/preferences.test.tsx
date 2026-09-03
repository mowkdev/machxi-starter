import { GRID_DENSITIES, LOCALES, THEMES } from "@repo/contracts";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AccountPreferencesSection } from "@/pages/account";
import { renderWithProviders } from "@/test/render";

/**
 * `/account/preferences` and the three controls on it (`D12.7`; ADR-0053 §2,
 * ADR-0046 §4, ADR-0055 §3).
 *
 * **One file where the admin has three**, and that is this app's shape rather
 * than a saving: there the density has a second surface in the grid's
 * page-header band, so its control is worth asserting away from the page it is
 * listed on. Here the section *is* every surface all three have (ADR-0055 §3
 * keeps `@repo/grid` out), so a per-feature file would assert the same render
 * from one import further away.
 *
 * **What is not asserted here is the account half.** None of these three slices
 * can tell whether there is an account — each writes what it owns and hands the
 * rest to a `publish` it never sees — and that is the property being relied on,
 * so the write-through lives where it is wired, in
 * `app/__tests__/settings-provider.test.tsx`.
 *
 * Every claim is by role and accessible name (ADR-0036): "one of three" is a
 * radio group rather than three buttons, and a control a screen reader cannot
 * announce is one a customer using one cannot operate.
 */
const render = (locale?: "lv") => {
  const user = userEvent.setup();

  renderWithProviders(
    <AccountPreferencesSection />,
    locale === undefined ? {} : { locale },
  );

  return user;
};

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  window.localStorage.clear();
});

describe("the preferences section", () => {
  it("lists every preference this app holds, each as a named group", () => {
    render();

    /*
     * Three groups and no more: the inventory ADR-0053 §2 asks for is only an
     * inventory if it is complete, and a fourth account fact arriving without a
     * card here is exactly the drift the record's one-inventory rule exists to
     * catch.
     */
    expect(screen.getAllByRole("group")).toHaveLength(3);
    expect(
      screen.getByRole("group", { name: "Appearance" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Language" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Rows" })).toBeInTheDocument();
  });

  it("offers exactly the values the contracts declare, and no others", () => {
    render();

    /*
     * Counted against the tuples rather than against a number written here
     * (ADR-0023): the tuples feed `pgEnum`, the request body and these groups,
     * so a value appended to one of them and forgotten in a control is a red
     * test rather than a mode nobody can choose.
     */
    const named = (group: string) =>
      screen
        .getAllByRole("radio")
        .filter(
          (radio) =>
            radio.closest("fieldset")?.getAttribute("aria-label") === group,
        );

    expect(named("Appearance")).toHaveLength(THEMES.length);
    expect(named("Language")).toHaveLength(LOCALES.length);
    expect(named("Rows")).toHaveLength(GRID_DENSITIES.length);
  });
});

describe("the appearance control", () => {
  it("paints the app and remembers the choice on the device", async () => {
    const user = render();

    await user.click(screen.getByRole("radio", { name: "Dark" }));

    expect(document.documentElement).toHaveClass("dark");
    // The device cache is written whether or not there is an account: it is
    // what `main.tsx` reads before React exists, so the next first paint is
    // right even for someone who has not signed in yet.
    expect(window.localStorage.getItem("machxi.user.theme")).toBe("dark");
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
    expect(window.localStorage.getItem("machxi.user.theme")).toBe("system");
  });
});

describe("the density control", () => {
  it("marks the mode in force, which is the only feedback this app can give", async () => {
    const user = render();

    /*
     * The admin's density control changes a table under the operator's eyes;
     * ADR-0055 §3 keeps the grid out of this app, so the checked radio *is* the
     * feedback until the first domain entity arrives. That makes this
     * assertion the whole of what a customer can see, rather than a detail
     * beside a redrawn table.
     */
    expect(screen.getByRole("radio", { name: "Comfortable" })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: "Compact" }));

    expect(screen.getByRole("radio", { name: "Compact" })).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Comfortable" }),
    ).not.toBeChecked();
  });
});

describe("the language control", () => {
  it("switches the app's language from the section", async () => {
    const user = render();

    await user.click(screen.getByRole("radio", { name: "Latviešu" }));

    expect(
      await screen.findByRole("group", { name: "Valoda" }),
    ).toBeInTheDocument();
  });

  it("names every option in its own language, from inside any language", async () => {
    render("lv");

    /*
     * ADR-0053 §2's escape hatch, and in this app it is the mitigation that
     * matters most: an operator stranded in a language they cannot read works
     * for the company that installed the panel, and a customer stranded in one
     * has nobody to ask. So the options are endonyms — the card's title moves
     * with the interface and the option labels never do.
     */
    expect(
      await screen.findByRole("group", { name: "Valoda" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "English" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Latviešu" })).toBeChecked();
  });
});
