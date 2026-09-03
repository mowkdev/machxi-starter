import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  SettingsOptions,
  type SettingsOptionsProps,
} from "../layouts/settings-options";

/**
 * The settings option group's own structure (`D11.10`, ADR-0054 §3/§7).
 *
 * Three features render this control and none of them owns its geometry, which
 * is the reason it exists — so the two values ADR-0054 records for it are
 * asserted here rather than three times over or nowhere. jsdom lays nothing
 * out, so these are class assertions in the D8 sense: the rung and the
 * selected marker are *decisions*, and a decision that only lives in a string
 * is one a re-tune can drop without a test noticing.
 *
 * The behaviour beside them is the browser's, and it is worth one case
 * precisely because it is not this file's code: exclusivity within a `name`,
 * and a click on a label reaching the input it wraps.
 */

const OPTIONS = [
  { value: "one" as const, label: "One" },
  { value: "two" as const, label: "Two" },
];

const renderOptions = (
  props: Partial<SettingsOptionsProps<"one" | "two">> = {},
) => {
  const onChange = vi.fn();

  render(
    <SettingsOptions
      label="Choice"
      layout="cards"
      name="choice"
      onChange={onChange}
      options={OPTIONS}
      value="one"
      {...props}
    />,
  );

  return onChange;
};

const boxOf = (name: string) =>
  screen.getByRole("radio", { name }).closest("label");

describe("the settings option group", () => {
  it("puts every option on the 44px settings-option rung", () => {
    renderOptions();

    // §3's `44 settings option row`, which ADR-0054 §7 assigns to both layouts
    // at `D11.10`: a card and a row differ in arrangement, not in height.
    for (const name of ["One", "Two"]) {
      expect(boxOf(name)).toHaveClass("h-11");
    }
  });

  it("keeps the rung when the layout stacks", () => {
    renderOptions({ layout: "rows" });

    expect(boxOf("One")).toHaveClass("h-11");
    // The one thing the layout does change: cards share the width, rows take
    // it. Asserted so "rows" cannot quietly become "cards with one per line".
    expect(boxOf("One")).not.toHaveClass("flex-1");
    /*
     * And the discriminator itself, which is on the group rather than on the
     * option — the review's third finding: inverting the ternary in
     * `settings-options.tsx` left every assertion above green while rows
     * rendered as a wrapping row.
     */
    expect(screen.getByRole("group", { name: "Choice" })).toHaveClass(
      "flex-col",
    );
  });

  it("marks the chosen option with the app's own selected treatment", () => {
    renderOptions();

    // The inset bar over `--primary-tint` that ADR-0054 §5 gives the sidebar
    // item and §4 the selected grid row — borrowed, so "the one you are on"
    // has one visual form in this app rather than three.
    expect(boxOf("One")).toHaveClass(
      "shadow-[inset_2px_0_0_var(--primary)]",
      "bg-primary-tint",
    );
    expect(boxOf("Two")).not.toHaveClass("bg-primary-tint");
    /*
     * **The hover twins, which are the state surviving the pointer.**
     * `hover:bg-accent` is on every option and outranks a plain
     * `bg-primary-tint` on specificity, so without these the selected option
     * turns grey the moment the pointer reaches it — a defect `packages/grid`
     * measured in Chrome at `D11.4` and wrote a comment about, and one that a
     * `toHaveClass("bg-primary-tint")` alone passes straight through.
     */
    expect(boxOf("One")).toHaveClass(
      "hover:bg-primary-tint",
      "hover:text-foreground",
    );
  });

  it("names the set, and reports a choice made through the label", async () => {
    const user = userEvent.setup();
    const onChange = renderOptions();

    expect(screen.getByRole("group", { name: "Choice" })).toBeInTheDocument();

    /*
     * The shared `name`, which is the whole native-radio argument and was
     * untested until the review said so: with `checked` controlled, every
     * other case here passes with `name` deleted — while the options stop
     * being one group, so arrow keys no longer move between them, Tab visits
     * each instead of only the selected one, and a screen reader loses "1 of
     * 2". That behaviour is exactly why `packages/ui` gains no Radix radio
     * primitive for this, so it is the one thing that must not be free to go.
     */
    expect(
      screen.getAllByRole("radio").map((radio) => radio.getAttribute("name")),
    ).toEqual(["choice", "choice"]);

    await user.click(screen.getByRole("radio", { name: "Two" }));

    expect(onChange).toHaveBeenCalledWith("two");
    // Controlled: the group renders what it was given, so a caller that
    // ignored the callback would show the old choice rather than a control
    // that has silently disagreed with the account.
    expect(screen.getByRole("radio", { name: "One" })).toBeChecked();
  });
});
