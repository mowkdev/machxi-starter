import type { Filter } from "@repo/contracts";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ColumnConfig, HotFilterConfig } from "@repo/resource";

import { AppliedFilters } from "../applied-filters";
import { HotFilters } from "../hot-filter-controls";
import { renderWithI18n } from "./support/render";

/**
 * The applied-filters bar, and the rule `D10.2` reversed (ADR-0052 §Visible
 * state, superseding ADR-0039's suppression).
 *
 * **The bar is the inventory, with no exceptions in it.** ADR-0039 skipped the
 * chip for a filter a pressed hot-filter button was already displaying, on the
 * argument that two removal affordances for one entry is noise; the operator's
 * call is that an inventory you have to cross-reference against the toolbar is
 * one you read twice. So the assertions below are the reversal, stated as
 * behaviour: a pressed button and a chip for the same filter, both present, and
 * the chip's removal releasing the button.
 *
 * **The round trip is rendered rather than reasoned about.** `HotFilters` and
 * `AppliedFilters` are two views of one array of `Filter`s, so the harness
 * holds that array in state and lets both read it — which is the only shape in
 * which "removing the chip unpresses the button" is a fact about the code
 * rather than about the test's own bookkeeping. No router: the URL round trip
 * is `list-state`'s own suite, and this is about what the two surfaces agree on
 * once a state exists.
 */

const STATUS: Extract<HotFilterConfig, { kind: "enum" }> = {
  kind: "enum",
  field: "status",
  label: "grid:filter.title",
  op: "eq",
  options: ["active", "disabled"],
};

const ACTIVE: Filter = { field: "status", op: "eq", value: "active" };

/**
 * A presence stance, for the `D11.4` cases at the foot of this file.
 *
 * Its label is any `grid:` key that resolves — the words are not the question
 * here, the `Button` variant is: a presence stance renders `outline`, which is
 * the variant that paints a ground of its own in dark.
 */
const DELETED_ONLY: Extract<HotFilterConfig, { kind: "presence" }> = {
  kind: "presence",
  field: "deletedAt",
  label: "grid:filter.any",
  op: "null",
  value: false,
};

/*
 * A column owning the field **and declaring the same filter the hot filter
 * writes**, which is what makes the chip read in the operator's words: a
 * column with a header alone is not "owning the field" as far as
 * `chipsForState` is concerned — `labelFor` reads `column.filter`, and without
 * one every chip here would come out as the deliberately ugly
 * `grid:chip.raw` rendering (`status eq active`) and the assertions below
 * would be about nothing.
 *
 * The header is a `grid:` key for the reason the sibling suite's fixtures are:
 * a `TranslationKey` inside this package resolves over the namespace the
 * package declares (ADR-0046 §13).
 */
const COLUMNS: readonly (readonly [string, ColumnConfig])[] = [
  [
    "status",
    {
      header: "grid:filter.title",
      filter: { kind: "enum", op: "eq", options: ["active", "disabled"] },
    },
  ],
];

/** The two surfaces over one state, which is what they are in `AppGrid`. */
const Both = ({
  initial = [ACTIVE],
  onChange,
}: {
  readonly initial?: readonly Filter[];
  readonly onChange?: (next: readonly Filter[]) => void;
}) => {
  const [filters, setFilters] = useState<readonly Filter[]>(initial);

  const commit = (next: readonly Filter[]) => {
    setFilters(next);
    onChange?.(next);
  };

  return (
    <>
      <HotFilters
        filters={filters}
        hotFilters={[STATUS]}
        onChange={(field, next) => {
          commit([...filters.filter((f) => f.field !== field), ...next]);
        }}
      />
      <AppliedFilters
        columns={COLUMNS}
        filters={filters}
        q=""
        onClearAll={() => {
          commit([]);
        }}
        onRemoveFilter={(filter) => {
          commit(filters.filter((f) => f !== filter));
        }}
        onRemoveSearch={() => {
          /* no search in this harness */
        }}
      />
    </>
  );
};

const chip = () => screen.getByRole("button", { name: /^Remove / });

/*
 * "Aktīvs", not "Active": the harness mounts a deliberately Latvian
 * `common.options` stub, so a button found by this name can only have got its
 * label from the catalogue rather than from `humanize`'s fallback (see
 * `support/render`). The same word reaches the chip through `chipsForState`,
 * which is what makes "both surfaces agree" an assertion about one value.
 */
const activeButton = () => screen.getByRole("button", { name: "Aktīvs" });

describe("the applied-filters bar", () => {
  it("renders a chip for a filter a hot filter is already displaying", () => {
    renderWithI18n(<Both />);

    /*
     * Both, at once — which is precisely what ADR-0039 forbade. The button's
     * `aria-pressed` is asserted alongside the chip so this case fails if the
     * suppression is reinstated *or* if the chip only appears because the
     * button stopped displaying the filter.
     */
    expect(activeButton()).toHaveAttribute("aria-pressed", "true");

    /*
     * The chip's *words*, not merely its presence — which is what makes this
     * "two surfaces agreeing about one value" rather than "two controls that
     * happen to be on screen". Both resolve `active` through the same
     * catalogue, so the button says Aktīvs and the chip says so too.
     */
    expect(chip()).toHaveAccessibleName(/Aktīvs/);
  });

  it("unpresses the hot filter when the chip is removed", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    renderWithI18n(<Both onChange={onChange} />);

    await user.click(chip());

    /*
     * The whole reversal's cost, paid: two affordances for one filter now
     * exist, and they must agree. A chip that removed the filter while the
     * button stayed lit would be worse than the suppression it replaced.
     */
    expect(activeButton()).toHaveAttribute("aria-pressed", "false");
    expect(onChange).toHaveBeenCalledWith([]);
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
  });

  it("keeps Clear all clearing the hot filter too", async () => {
    const user = userEvent.setup();

    renderWithI18n(<Both />);

    await user.click(screen.getByRole("button", { name: "Clear all" }));

    // Unchanged by ADR-0052, and asserted because it is the half of ADR-0039
    // that the reversal did *not* touch.
    expect(activeButton()).toHaveAttribute("aria-pressed", "false");
    expect(
      document.querySelector('[data-slot="grid-applied-filters"]'),
    ).toBeNull();
  });

  it("renders nothing at all when nothing is applied", () => {
    renderWithI18n(<Both initial={[]} />);

    /*
     * The band's absence is load-bearing (ADR-0037): a permanent empty row
     * above every unfiltered grid takes height from the budget, and it is what
     * the deleted filter row cost.
     */
    expect(
      document.querySelector('[data-slot="grid-applied-filters"]'),
    ).toBeNull();
  });
});

/**
 * The "Filtered by" band and the segmented hot filters (ADR-0054 §5, `D11.4`).
 *
 * Presentation only, and the describe above is the proof of that: every
 * behavioural assertion `D10.2` wrote is untouched and still green beside
 * these. What lands here is the anatomy — a 40px band that names itself in
 * §3's caps voice, 26px chips on `--primary-tint`, an underlined Clear all,
 * and hot filters drawn as a 30px track of 26px segments instead of `D4.4`'s
 * grey pills.
 */
describe("Instrument's filter chrome", () => {
  const band = (): HTMLElement | null =>
    document.querySelector('[data-slot="grid-applied-filters"]');

  it("names the band in the caps voice, at 40px", () => {
    renderWithI18n(<Both />);

    expect(band()).toHaveClass("min-h-10", "shrink-0", "px-4");

    /*
     * The label is a `span` rather than a control, so it is found by its text
     * and its voice is asserted where §3 writes it: 11/16·600·0.07em caps, the
     * same one the column heads took at `D11.2`.
     */
    const label = screen.getByText("Filtered by");

    expect(label).toHaveClass(
      "text-[11px]",
      "font-semibold",
      "tracking-[0.07em]",
      "uppercase",
    );
  });

  it("draws the chip at 26px on the tint, and Clear all as underlined text", () => {
    renderWithI18n(<Both />);

    /*
     * The chip is the `Badge` the removal button sits inside — asserted from
     * the control outwards, because the control is the thing with a name and
     * the badge is the shape around it.
     */
    const badge = chip().closest('[data-slot="badge"]');

    expect(badge).toHaveClass("h-[26px]", "rounded-md", "bg-primary-tint");

    /*
     * `rounded-md` is §2's chip rung, and it is asserted *against* the
     * primitive's own `rounded-full` — the one value §2's "nothing rounder
     * than 8" forbids, and the reason the assignment is made at the call site.
     */
    expect(badge).not.toHaveClass("rounded-full");

    expect(screen.getByRole("button", { name: "Clear all" })).toHaveClass(
      "underline",
    );
  });

  it("draws the hot filters as a 30px track of 26px segments", () => {
    renderWithI18n(<Both />);

    /*
     * Scoped to the `role="group"`, because `data-slot="hot-filter"` names two
     * shapes: the enum's track and the presence stance's own button. This
     * fixture renders only the first, but `/users` declares both, and an
     * unscoped selector would assert a track's anatomy against whichever
     * happened to come first in the DOM.
     */
    const track = document.querySelector(
      '[role="group"][data-slot="hot-filter"]',
    );

    expect(track).toHaveClass("h-[30px]", "rounded-md", "border", "bg-muted");

    /*
     * The pressed segment speaks the same tint as the chip it now duplicates
     * (`D10.2` made them duplicates on purpose), which is what makes "this
     * filter is on" one visual statement rather than two.
     */
    expect(activeButton()).toHaveClass(
      "h-[26px]",
      "bg-primary-tint",
      "text-primary",
    );

    // And the unpressed one does not, so the tint is state rather than decoration.
    expect(screen.getByRole("button", { name: "Atspējots" })).not.toHaveClass(
      "bg-primary-tint",
    );
  });

  /*
   * The `dark:` twins, asserted because a browser found them missing (`D11.4`).
   * `Button` spells part of every variant under `dark:` — ghost's
   * `dark:hover:bg-accent/50`, outline's `dark:bg-input/30` — and `cn` merges
   * per modifier chain, so an unprefixed `bg-primary-tint` displaces neither
   * and loses the specificity contest besides. Without these classes a pressed
   * segment went grey under the pointer in dark and a pressed presence stance
   * showed no tint at all, with every light-theme assertion above still green.
   */
  it("keeps the pressed tint in dark, where the primitive spells its own state", () => {
    renderWithI18n(<Both />);

    expect(activeButton()).toHaveClass(
      "dark:bg-primary-tint",
      "dark:hover:bg-primary-tint",
    );
  });

  it("gives a presence stance the track's height and the same pressed tint", () => {
    /*
     * Its own render, because the harness above is enum-only and the two kinds
     * take different `Button` variants — outline is the one that paints a
     * ground in dark at rest, which is where this was worst.
     */
    renderWithI18n(
      <HotFilters
        hotFilters={[DELETED_ONLY]}
        filters={[{ field: "deletedAt", op: "null", value: false }]}
        onChange={() => {
          /* the write is `hot-filters`' own suite */
        }}
      />,
    );

    const stance = screen.getByRole("button", { name: "Any" });

    expect(stance).toHaveAttribute("aria-pressed", "true");
    expect(stance).toHaveClass(
      "h-[30px]",
      "bg-primary-tint",
      "dark:bg-primary-tint",
      "border-primary/40",
      "dark:border-primary/40",
    );
  });
});
