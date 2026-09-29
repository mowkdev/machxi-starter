import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMemoryStorage,
  gridStorageKey,
  type PreferenceStorage,
} from "../preferences";
import { KEY_PREFIX } from "./support/demo-i18n";
import { ALL, Harness, pageOf } from "./support/demo-harness";
import { demoRows } from "./support/demo-resource";

/**
 * The Columns surface and what it persists, end to end through a real
 * `AppGrid`, a real `gridId` and a real store (ADR-0041).
 *
 * **Moved from the admin at `D22.3`** (ADR-0077 §4), out of
 * `shared/grid/__tests__/app-grid.test.tsx`. The one change is the storage
 * key: the admin's door bound its device prefix, and here the prefix is the
 * harness's own, passed exactly as the door passes the app's.
 */

describe("grid preferences", () => {
  const GRID = "widget";

  /*
   * A fresh in-memory adapter per test, which is ADR-0041's seam used as the
   * ADR says it will be. It is not only isolation: without it these tests fall
   * through to the real `localStorage`, and the first one to hide a column
   * would hand its arrangement to the next — a suite whose result depends on
   * its order, produced by the very persistence it is checking.
   */
  let storage: PreferenceStorage;

  beforeEach(() => {
    storage = createMemoryStorage();
  });

  const openColumns = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: "Columns" }));

    return within(await screen.findByRole("dialog"));
  };

  const headers = (): readonly string[] =>
    screen
      .getAllByRole("columnheader")
      .map((header) => header.textContent ?? "");

  const entry = (storage: PreferenceStorage): Record<string, unknown> | null =>
    JSON.parse(
      storage.read(gridStorageKey(KEY_PREFIX, GRID)) ?? "null",
    ) as Record<string, unknown> | null;

  it("offers every column the resource declares, and none of the grid's own", async () => {
    const user = userEvent.setup();

    render(<Harness page={pageOf(demoRows)} gridId={GRID} storage={storage} />);

    const menu = await openColumns(user);

    for (const label of ["Name", "Status", "Tags", "Created", "Archived"])
      expect(menu.getByRole("checkbox", { name: label })).toBeInTheDocument();

    /*
     * Structural columns are **absent, not disabled** (ADR-0041). The selection
     * checkbox and the row-actions column are the grid's own chrome: hiding the
     * actions column would strand every row's menu behind a preference, and
     * there is no flag anywhere to forget, because they were never offered.
     */
    expect(menu.queryByRole("checkbox", { name: "Actions" })).toBeNull();
    expect(menu.queryByRole("button", { name: "Move Actions up" })).toBeNull();
  });

  it("hides a column, and the header goes with it", async () => {
    const user = userEvent.setup();

    render(<Harness page={pageOf(demoRows)} gridId={GRID} storage={storage} />);

    expect(headers()).toContain("Tags");

    await user.click(
      (await openColumns(user)).getByRole("checkbox", { name: "Tags" }),
    );

    expect(headers()).not.toContain("Tags");
    // And the rows follow the header, which is `getVisibleCells` doing its job:
    // a row still rendering every cell would put its data under the wrong ones.
    expect(screen.queryByRole("cell", { name: "alpha" })).toBeNull();
  });

  it("moves a column, and the order follows", async () => {
    const user = userEvent.setup();

    render(<Harness page={pageOf(demoRows)} gridId={GRID} storage={storage} />);

    expect(headers()).toEqual([
      "Name",
      "Status",
      "Tags",
      "Created",
      "Archived",
      "Actions",
    ]);

    await user.click(
      (await openColumns(user)).getByRole("button", { name: "Move Status up" }),
    );

    expect(headers()).toEqual([
      "Status",
      "Name",
      "Tags",
      "Created",
      "Archived",
      "Actions",
    ]);
  });

  it("moves a column by keyboard drag, and the same preference follows", async () => {
    const user = userEvent.setup();

    /*
     * **The drag's path into ADR-0041's preferences, asserted where the store
     * is real** (`D10.3`, ADR-0052 §Visible state). `@repo/grid`'s own suite
     * drives the same gesture against a harness that re-implements the splice,
     * so it can prove the sortable works and cannot prove where the result
     * lands. Only here — real `AppGrid`, real `gridId`, real storage — does
     * "a drop writes the preference an arrow writes" become a fact.
     *
     * jsdom lays nothing out and `closestCenter` compares centres, so the rows
     * are given stacked rects for the length of this test. `vi.spyOn` rather
     * than an assignment, so `restoreMocks` puts it back before the next case
     * — and installed *inside* the test for the same reason.
     */
    const ROW_HEIGHT = 40;

    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function rect(this: Element) {
        const row = this.closest<HTMLElement>('[data-slot="columns-menu-row"]');
        const siblings = [...(row?.parentElement?.children ?? [])];
        const index = row === null ? -1 : siblings.indexOf(row);
        const top = index === -1 ? 0 : index * ROW_HEIGHT;

        return {
          x: 0,
          y: top,
          top,
          left: 0,
          bottom: top + ROW_HEIGHT,
          right: 240,
          width: 240,
          height: ROW_HEIGHT,
          toJSON: () => ({}),
        } as DOMRect;
      },
    );

    render(<Harness page={pageOf(demoRows)} gridId={GRID} storage={storage} />);

    await openColumns(user);

    screen.getByRole("button", { name: "Reorder Status" }).focus();
    await user.keyboard("{ }");
    await user.keyboard("{ArrowUp}");
    await user.keyboard("{ }");

    expect(headers()).toEqual([
      "Status",
      "Name",
      "Tags",
      "Created",
      "Archived",
      "Actions",
    ]);

    /*
     * And it is *persisted*, in the same entry the arrows write — one
     * preference, two gestures, which is the ADR-0041 claim this step could
     * have broken by writing the order anywhere else.
     */
    expect(entry(storage)?.["order"]).toEqual([
      "status",
      "name",
      "tags",
      "createdAt",
      "archivedAt",
    ]);
  });

  it("keeps the grid's own chrome at the ends, whatever the operator does", async () => {
    const user = userEvent.setup();

    render(
      <Harness
        page={pageOf(demoRows)}
        gridId={GRID}
        storage={storage}
        capabilities={ALL}
      />,
    );

    // Selection first, actions last, before anything is touched.
    expect(headers().at(0)).toBe("");
    expect(headers().at(-1)).toBe("Actions");

    const menu = await openColumns(user);

    // Move the last movable column down as far as the menu allows…
    expect(
      menu.getByRole("button", { name: "Move Archived down" }),
    ).toBeDisabled();

    await user.click(menu.getByRole("button", { name: "Move Name down" }));

    /*
     * …and the ends are still the ends. Their position is a property of
     * `AppGrid`, composed around the operator's arrangement rather than stored
     * with it, so there is no ordering an operator can reach that puts the row
     * menu in the middle of the data.
     */
    expect(headers().at(0)).toBe("");
    expect(headers().at(-1)).toBe("Actions");
  });

  it("restores the arrangement on the next mount", async () => {
    const user = userEvent.setup();

    const first = render(
      <Harness page={pageOf(demoRows)} gridId={GRID} storage={storage} />,
    );

    const menu = await openColumns(user);

    await user.click(menu.getByRole("checkbox", { name: "Tags" }));
    await user.click(menu.getByRole("button", { name: "Move Status up" }));

    // Closed first, so no Radix overlay is left mounted at teardown to keep
    // mutating the document for the tests after this one.
    await user.keyboard("{Escape}");

    // A remount over the same storage is what a reload is (ADR-0041's round
    // trip); the store re-reads, re-validates and reconciles on the way in.
    first.unmount();
    render(<Harness page={pageOf(demoRows)} gridId={GRID} storage={storage} />);

    expect(headers()).toEqual([
      "Status",
      "Name",
      "Created",
      "Archived",
      "Actions",
    ]);
  });

  it("keeps two grids' arrangements apart", async () => {
    const user = userEvent.setup();

    const first = render(
      <Harness page={pageOf(demoRows)} gridId={GRID} storage={storage} />,
    );

    await user.click(
      (await openColumns(user)).getByRole("checkbox", { name: "Tags" }),
    );
    await user.keyboard("{Escape}");
    first.unmount();

    // One entry per grid: a second grid over the same storage restores its own
    // defaults, not the first one's arrangement.
    render(
      <Harness page={pageOf(demoRows)} gridId="other" storage={storage} />,
    );

    expect(headers()).toContain("Tags");
  });

  it("stores column names and numbers, and nothing from the rows", async () => {
    const user = userEvent.setup();

    render(<Harness page={pageOf(demoRows)} gridId={GRID} storage={storage} />);

    await user.click(
      (await openColumns(user)).getByRole("checkbox", { name: "Tags" }),
    );

    /*
     * The ADR-0033 carve-out this store stands on, asserted end to end rather
     * than only over the store: what an XSS reading this key learns is which
     * columns an operator prefers. No row data, no filter value, nothing typed.
     */
    expect(entry(storage)).toEqual({
      v: 1,
      sizing: {},
      order: ["name", "status", "tags", "createdAt", "archivedAt"],
      hidden: ["tags"],
    });
  });

  it("resizes from the keyboard as well as the pointer", async () => {
    const user = userEvent.setup();

    render(<Harness page={pageOf(demoRows)} gridId={GRID} storage={storage} />);

    /*
     * The handle is a named button, not a bare `div` with `onMouseDown`
     * (ADR-0041, amended `D4.5`): a drag is the natural gesture and it cannot
     * be the *only* one, or column width becomes the single grid affordance in
     * this panel that a keyboard cannot reach. jsdom has no layout, so the
     * measured start width is 0 and the floor is what the nudge lands on —
     * which is the clamp doing its job either way.
     */
    const handle = screen.getByRole("button", { name: "Resize Name" });

    handle.focus();
    await user.keyboard("{ArrowRight}");

    expect(entry(storage)?.["sizing"]).toEqual({ name: 64 });
  });

  it("refuses to hide the last visible column", async () => {
    const user = userEvent.setup();

    render(<Harness page={pageOf(demoRows)} gridId={GRID} storage={storage} />);

    const menu = await openColumns(user);

    for (const label of ["Status", "Tags", "Created", "Archived"])
      await user.click(menu.getByRole("checkbox", { name: label }));

    /*
     * A grid with no columns is not a preference, it is a blank rectangle where
     * the data was — and the one control that undoes it lives inside this menu,
     * which is a worse place to discover the mistake than to prevent it. The
     * last one standing is disabled rather than left to be clicked.
     */
    expect(menu.getByRole("checkbox", { name: "Name" })).toBeDisabled();
    expect(
      screen.getAllByRole("columnheader").map((header) => header.textContent),
    ).toEqual(["Name", "Actions"]);
  });

  it("returns to the config on Reset, and takes the entry with it", async () => {
    const user = userEvent.setup();

    render(<Harness page={pageOf(demoRows)} gridId={GRID} storage={storage} />);

    const menu = await openColumns(user);

    await user.click(menu.getByRole("checkbox", { name: "Tags" }));
    await user.click(menu.getByRole("button", { name: "Move Status up" }));
    expect(entry(storage)).not.toBeNull();

    await user.click(menu.getByRole("button", { name: "Reset to defaults" }));

    expect(headers()).toEqual([
      "Name",
      "Status",
      "Tags",
      "Created",
      "Archived",
      "Actions",
    ]);
    /*
     * Removed, not overwritten with today's defaults — so a column the config
     * gains tomorrow arrives at its own default rather than inheriting a frozen
     * snapshot of this one.
     */
    expect(entry(storage)).toBeNull();
  });

  it("offers Reset only when something deviates", async () => {
    const user = userEvent.setup();

    render(<Harness page={pageOf(demoRows)} gridId={GRID} storage={storage} />);

    const menu = await openColumns(user);

    expect(
      menu.getByRole("button", { name: "Reset to defaults" }),
    ).toBeDisabled();

    await user.click(menu.getByRole("checkbox", { name: "Tags" }));

    expect(
      menu.getByRole("button", { name: "Reset to defaults" }),
    ).toBeEnabled();
  });

  it("persists nothing for a grid with no id", async () => {
    const user = userEvent.setup();
    const storage: PreferenceStorage = {
      read: vi.fn(() => null),
      write: vi.fn(),
      remove: vi.fn(),
    };

    render(<Harness page={pageOf(demoRows)} storage={storage} />);

    await user.click(
      (await openColumns(user)).getByRole("checkbox", { name: "Tags" }),
    );

    /*
     * The arrangement still works for the life of the component — the header is
     * gone — it simply has nowhere to be written. Persisting under a shared
     * fallback key would be worse than not persisting: two unrelated grids
     * would fight over one entry and each would restore the other's layout.
     */
    expect(headers()).not.toContain("Tags");
    expect(storage.write).not.toHaveBeenCalled();
  });
});
