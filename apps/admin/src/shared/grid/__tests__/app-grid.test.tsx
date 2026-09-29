import type { Page } from "@repo/contracts";
import { render, screen } from "@testing-library/react";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";

import { GridDensityProvider } from "@/shared/density";
import {
  demoResourceConfig,
  demoRows,
  type DemoRow,
} from "@/test/fixtures/demo-resource";
import { createTestI18n } from "@/test/render";

import { AppGrid } from "../app-grid";
import { listSearchDefaults } from "../list-state";

/**
 * The grid door's smoke test (`D22.3`, ADR-0077 §4).
 *
 * **What `@repo/grid` does is certified in `@repo/grid`.** Until `D22.3` this
 * file was the package's certification — 1,839 lines of the grid driven through
 * this door — and those cases moved into the package's own suite, split by
 * concern. What stays is what only this app can show: that its door hands the
 * package the app's values. The density is the binding a page would notice
 * losing, so it is the one asserted, and these two cases are the ones that
 * asserted it before the move.
 */

const page: Page<DemoRow> = {
  items: demoRows,
  total: demoRows.length,
  offset: 0,
  limit: 20,
  sort: [],
  filters: {},
};

/** The door's `AppGrid`, over the demo config, with its state held locally. */
const Harness = () => {
  const [listState, setListState] = useState(listSearchDefaults);
  const [i18n] = useState(createTestI18n);

  return (
    <I18nextProvider i18n={i18n.instance}>
      <AppGrid<DemoRow>
        columns={demoResourceConfig.columns}
        page={page}
        listState={listState}
        getRowId={(row) => row.id}
        onListStateChange={setListState}
      />
    </I18nextProvider>
  );
};

/**
 * The door's other binding (`D11.6`, ADR-0053 §2).
 *
 * `@repo/grid` takes the density as a prop and this app reads it once, here,
 * so that the account's mode reaches every table without a page remembering to
 * pass it. What the package does *with* the mode — the three values that move
 * — is asserted in its own suite; what this asserts is the wire between the
 * account fact and the table, which is the part the extraction could break.
 */
describe("the density the door binds", () => {
  const bodyCells = (): HTMLElement[] =>
    screen
      .getAllByRole("cell")
      .filter((cell) => cell.closest("tbody") !== null);

  it("packs the rows comfortably with no provider above it", () => {
    // A table is allowed to exist without an account: the door reads the
    // *value* hook, which answers the contract's default rather than throwing.
    render(<Harness />);

    expect(bodyCells().length).toBeGreaterThan(0);

    for (const cell of bodyCells()) {
      expect(cell).toHaveClass("h-[44px]");
    }
  });

  it("hands the table the account's mode when there is one", () => {
    render(
      <GridDensityProvider adopted="compact">
        <Harness />
      </GridDensityProvider>,
    );

    // The sibling's guard (the `D22.3` review): a body with no cells would
    // otherwise pass the loop below having asserted nothing.
    expect(bodyCells().length).toBeGreaterThan(0);

    for (const cell of bodyCells()) {
      expect(cell).toHaveClass("h-[34px]");
      expect(cell).not.toHaveClass("h-[44px]");
    }
  });
});
