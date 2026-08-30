import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ColumnsMenu, type ColumnsMenuEntry } from "../columns-menu";
import { renderWithI18n } from "./support/render";

/**
 * The columns menu's drag-and-drop reorder (ADR-0052 §Visible state, `D10.3`;
 * ADR-0041 for what a reorder *is*).
 *
 * **The keyboard path is the one under test, and that is the point.** ADR-0052
 * chose `@dnd-kit` over native HTML5 drag-and-drop for its keyboard
 * operability — a pointer-only handle would have left the up/down arrows
 * carrying accessibility alone. So the assertion is a reorder performed the way
 * `sortableKeyboardCoordinates` offers it: focus the grip, Space to lift, an
 * arrow to move, Space to drop. A test that only fired `onDragEnd` by hand
 * would assert the callback's plumbing and nothing about whether the sortable
 * this dependency was taken for actually works under React 19.
 *
 * **jsdom lays nothing out, so the rows are given rects.** `closestCenter`
 * resolves a drop by comparing droppable centres, and every element in jsdom
 * reports a zero rect — every row's centre is the same point and the sortable
 * has no way to say which row it is over. The `getBoundingClientRect` stub
 * below is the smallest possible layout: rows 40px tall, stacked. It is a
 * harness fact, not a fixture — the geometry it describes is the geometry the
 * browser would produce, and `D10.4`'s spec is what checks the real one.
 *
 * A spy rather than an assignment to the prototype, so `restoreMocks` in
 * `@repo/vitest-config` puts it back: file isolation happens to make a raw
 * assignment harmless today, and "harmless because of a setting nobody in this
 * file can see" is how a suite starts poisoning its neighbours.
 */

const ENTRIES: readonly ColumnsMenuEntry[] = [
  { id: "email", label: "Email", isVisible: true },
  { id: "status", label: "Status", isVisible: true },
  { id: "createdAt", label: "Created", isVisible: true },
];

const ROW_HEIGHT = 40;

beforeEach(() => {
  /*
   * Every element gets a rect derived from its position among its siblings, so
   * the three rows stack instead of collapsing onto one point. Anything that
   * is not a sortable row lands at the origin, which is where dnd-kit ignores
   * it.
   *
   * **`beforeEach`, not `beforeAll`**, and the difference is the whole suite:
   * `@repo/vitest-config` sets `restoreMocks`, which puts spies back *before
   * every test* — so one installed once is already gone by the first case, the
   * rows collapse onto a single point, and the arrow key finds nothing to move
   * over. The failure is silent: the lift still happens and announces itself,
   * and only the reorder never lands.
   */
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function rect(this: Element) {
      const row = this.closest<HTMLElement>('[data-slot="columns-menu-row"]');
      const siblings =
        row === null ? [] : [...(row.parentElement?.children ?? [])];
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
});

/** The menu over state, which is what `AppGrid` is to it. */
const Menu = ({
  onOrder,
}: {
  readonly onOrder?: (ids: readonly string[]) => void;
}) => {
  const [order, setOrder] = useState<readonly string[]>(
    ENTRIES.map((entry) => entry.id),
  );

  const commit = (next: readonly string[]) => {
    setOrder(next);
    onOrder?.(next);
  };

  /*
   * The same splice `AppGrid`'s `reorderTo` performs, over the same ids —
   * this harness stands in for the preference, so what it holds after a
   * gesture is what the store would hold.
   */
  const reorder = (activeId: string, overId: string) => {
    const from = order.indexOf(activeId);
    const to = order.indexOf(overId);
    const next = [...order];
    const [moved] = next.splice(from, 1);

    if (moved === undefined) return;
    next.splice(to, 0, moved);
    commit(next);
  };

  return (
    <ColumnsMenu
      entries={order.map((id) => {
        const entry = ENTRIES.find((candidate) => candidate.id === id);

        if (entry === undefined) throw new Error(`unknown column ${id}`);

        return entry;
      })}
      isDirty={order.join() !== ENTRIES.map((entry) => entry.id).join()}
      onMove={(id, direction) => {
        const from = order.indexOf(id);
        const next = [...order];
        const [moved] = next.splice(from, 1);

        if (moved === undefined) return;
        next.splice(from + direction, 0, moved);
        commit(next);
      }}
      onReorder={reorder}
      onToggle={() => {
        // Visibility is `D4.5`'s and untouched by this step; the rows need the
        // checkboxes present — `labels()` reads the order off them — but
        // nothing here toggles one.
      }}
      onReset={() => {
        commit(ENTRIES.map((entry) => entry.id));
      }}
    />
  );
};

it("draws its trigger as the band's icon-only 34, not a labelled button", () => {
  renderWithI18n(<Menu />);

  /*
   * The treatment, in the tier that gates (`D11.12`, ADR-0054 §5).
   *
   * `test:e2e` measures this pair at 34x34 and bordered, but that tier runs
   * *beside* the gate and never in it — so without this case a revert to
   * `size="sm" h-8` with a visible "Columns" label would pass
   * `lint && check-types && test && size` in silence. The name is asserted
   * with it, because moving the label to `aria-label` is what makes
   * icon-only safe and a revert of *that* is the one an icon assertion
   * alone would miss.
   */
  const trigger = screen.getByRole("button", { name: "Columns" });

  expect(trigger).toHaveClass("size-[34px]");
  expect(trigger).toHaveAttribute("aria-label", "Columns");
  expect(trigger).toHaveTextContent("");
});

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Columns" }));
  await screen.findByText("Email");
};

/** The rows in render order, read by their label. */
const labels = (): string[] =>
  screen
    .getAllByRole("checkbox")
    .map((box) => box.id.replace("column-", ""))
    .map((id) => ENTRIES.find((entry) => entry.id === id)?.label ?? "unknown");

describe("the columns menu", () => {
  it("reorders by keyboard through the sortable, and reports it as ids", async () => {
    const user = userEvent.setup();
    const onOrder = vi.fn();

    renderWithI18n(<Menu onOrder={onOrder} />);
    await openMenu(user);

    expect(labels()).toEqual(["Email", "Status", "Created"]);

    /*
     * The gesture `@dnd-kit` documents, driven as an operator would: tab focus
     * onto the grip, Space to lift, one step down, Space to drop.
     */
    const grip = screen.getByRole("button", { name: "Reorder Email" });

    grip.focus();
    await user.keyboard("{ }");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ }");

    expect(onOrder).toHaveBeenCalledWith(["status", "email", "createdAt"]);
    expect(labels()).toEqual(["Status", "Email", "Created"]);
  });

  it("still moves a column with the arrow buttons, and still resets", async () => {
    const user = userEvent.setup();

    renderWithI18n(<Menu />);
    await openMenu(user);

    /*
     * ADR-0052 kept the arrows deliberately: a drag is faster and imprecise, an
     * arrow is exact. The reset is asserted *after* a reorder rather than on a
     * clean menu, because a Reset that cannot undo the new gesture is the way
     * this step could quietly break ADR-0041's promise that order is one
     * preference however it was written.
     */
    await user.click(screen.getByRole("button", { name: "Move Email down" }));

    expect(labels()).toEqual(["Status", "Email", "Created"]);

    await user.click(screen.getByRole("button", { name: "Reset to defaults" }));

    expect(labels()).toEqual(["Email", "Status", "Created"]);
  });

  it("cancels the drag on Escape and keeps the menu open", async () => {
    const user = userEvent.setup();
    const onOrder = vi.fn();

    renderWithI18n(<Menu onOrder={onOrder} />);
    await openMenu(user);

    screen.getByRole("button", { name: "Reorder Email" }).focus();
    await user.keyboard("{ }");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Escape}");

    /*
     * Escape belongs to the drag, not to the Popover. `@dnd-kit`'s own
     * instructions advertise it as the cancel gesture, and Radix's dismiss
     * layer — mounted first, so it answers first — would otherwise take the
     * same keystroke and close the menu, which is a worse outcome than the
     * drag being undone.
     */
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(onOrder).not.toHaveBeenCalled();
    expect(labels()).toEqual(["Email", "Status", "Created"]);
  });

  it("names every grip after its column", async () => {
    const user = userEvent.setup();

    renderWithI18n(<Menu />);
    await openMenu(user);

    /*
     * Three handles that all said "Reorder" would be three controls a screen
     * reader cannot tell apart — the same rule the arrows have followed since
     * `D4.5`, and the reason a test never has to count rows.
     */
    for (const entry of ENTRIES) {
      expect(
        screen.getByRole("button", { name: `Reorder ${entry.label}` }),
      ).toBeInTheDocument();
    }
  });

  it("announces the drag in the catalogue's words, naming the column rather than its id", async () => {
    const user = userEvent.setup();

    renderWithI18n(<Menu />);
    await openMenu(user);

    /*
     * `@dnd-kit`'s defaults are English literals that interpolate the item's
     * **id** — "Draggable item createdAt was dropped over droppable area
     * email" — so this asserts the thing ADR-0052 §Alternatives took the
     * dependency for: the announcement says "Email", the word on screen, and
     * says it from this package's catalogue. `createdAt` appearing anywhere in
     * the live region is the default leaking back.
     */
    screen.getByRole("button", { name: "Reorder Email" }).focus();
    await user.keyboard("{ }");

    const live = document.querySelector('[role="status"]');

    /*
     * The lift's own "Picked up Email…" is not asserted, because it does not
     * survive to be read: dnd-kit fires `onDragOver` immediately after
     * `onDragStart` — the lifted row is over itself — so the region already
     * holds the move announcement by the time a test looks. Both come from the
     * same catalogue and the same label lookup, so the one that lasts is the
     * one worth asserting.
     */
    expect(live).toHaveTextContent("Email moved to position 1 of 3.");

    await user.keyboard("{ArrowDown}");

    /*
     * The position travels with the drag, which is the part an operator who
     * cannot see the list is relying on entirely.
     */
    expect(live).toHaveTextContent("Email moved to position 2 of 3.");
    expect(live).not.toHaveTextContent("createdAt");

    /*
     * And the instructions the grip points at with `aria-describedby`, which
     * is the other half of what dnd-kit hard-codes.
     */
    const grip = screen.getByRole("button", { name: "Reorder Email" });
    const described = document.getElementById(
      grip.getAttribute("aria-describedby") ?? "",
    );

    expect(described).toHaveTextContent("Press space or enter to pick up");
    expect(grip).toHaveAttribute("aria-roledescription", "sortable column");

    await user.keyboard("{Escape}");
  });
});
