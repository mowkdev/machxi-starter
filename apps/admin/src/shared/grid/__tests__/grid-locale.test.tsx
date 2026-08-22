import type { ListQuerySearch, Page } from "@repo/contracts";
import { render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";

import { listSearchDefaults } from "@/shared/grid/list-state";
import type { I18n } from "@/shared/i18n";
import {
  demoResourceConfig,
  demoRows,
  type DemoRow,
} from "@/test/fixtures/demo-resource";
import { createTestI18n } from "@/test/render";

import { AppGrid } from "../app-grid";

/**
 * A locale switch, seen from the grid (ADR-0046 §5, `D7.2`).
 *
 * The claim under test is the one the sweep would otherwise only assert about
 * *copy*: a grid's **dates** are chrome too, and they follow the app's locale
 * rather than the machine's. Before `D7.2` every `Intl.DateTimeFormat` in
 * `shared/grid` was built with `undefined`, which reads the browser's language
 * — so this test would have passed on a Latvian laptop and failed on an English
 * one, or the reverse, which is the shape of bug that survives a review.
 *
 * It switches through `changeLocale` rather than by remounting, because that is
 * the path the settings page will take in `D7.5`: the instance stays, the
 * listener swaps the tag, and react-i18next re-renders the tree that is already
 * on screen.
 *
 * `lv`'s catalogues are still `{}` at this step, so the **copy** deliberately
 * stays English here — that is the `en` fallback working, and `D7.6` is what
 * fills them. What must change is the formatting, and it does.
 */

const base: ListQuerySearch = listSearchDefaults;

const page: Page<DemoRow> = {
  items: demoRows,
  total: demoRows.length,
  offset: 0,
  limit: 20,
  sort: [],
  filters: {},
};

const renderGrid = (i18n: I18n) => {
  const Harness = () => {
    const [listState, setListState] = useState(base);

    return (
      <AppGrid
        columns={demoResourceConfig.columns}
        page={page}
        listState={listState}
        onListStateChange={setListState}
        getRowId={(row) => row.id}
      />
    );
  };

  return render(
    <I18nextProvider i18n={i18n.instance}>
      <Harness />
    </I18nextProvider>,
  );
};

/** The `createdAt` cell of the first row — `2026-01-15T10:00:00.000Z`. */
const createdCell = (): HTMLElement => {
  const [, firstBodyRow] = screen.getAllByRole("row");

  if (firstBodyRow === undefined) throw new Error("the grid rendered no rows");

  // `name`, `status`, `tags`, `createdAt` — the demo config's order.
  const cells = within(firstBodyRow).getAllByRole("cell");
  const created = cells[3];

  if (created === undefined) throw new Error("no createdAt cell");

  return created;
};

describe("the grid under a locale switch", () => {
  it("formats its dates in en-GB before anything is switched", () => {
    renderGrid(createTestI18n());

    // European order, because `en` means en-GB (ADR-0046 §5) — not the runner's
    // locale, which is what `undefined` used to resolve to.
    expect(createdCell()).toHaveTextContent("15 Jan 2026");
  });

  it("re-formats them when the language changes, without a remount", async () => {
    const i18n = createTestI18n();

    renderGrid(i18n);

    const before = createdCell().textContent;

    await i18n.changeLocale("lv");

    await waitFor(() => {
      expect(createdCell().textContent).not.toBe(before);
    });

    /*
     * The Latvian rendering itself is CLDR's; asserting it byte for byte would
     * make the suite fail on an ICU upgrade that improved it. What is asserted
     * is that the switch reached the formatter — and that the *copy* did not
     * move, because `lv`'s catalogues are empty until `D7.6` and the `en`
     * fallback is exactly what should show meanwhile.
     */
    expect(createdCell().textContent).toContain("2026");
    expect(
      screen.getByRole("button", { name: "Next page" }),
    ).toBeInTheDocument();
  });
});
