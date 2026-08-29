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
