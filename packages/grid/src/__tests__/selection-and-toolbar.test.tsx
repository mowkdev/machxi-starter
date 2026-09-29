import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ALL, Harness, pageOf } from "./support/demo-harness";
import { demoRows, type DemoRow } from "./support/demo-resource";

/**
 * What an operator may do to rows: the row menu, selection and the toolbar a
 * capability block composes (ADR-0038).
 *
 * **Moved from the admin at `D22.3`** (ADR-0077 §4), out of
 * `shared/grid/__tests__/app-grid.test.tsx`, with its assertions unchanged.
 */

describe("row actions", () => {
  it("takes its handlers from meta and hands back the typed row", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <Harness
        page={pageOf(demoRows)}
        meta={{
          rowActions: [
            { key: "edit", label: "Edit", onSelect },
            {
              key: "delete",
              label: "Delete",
              destructive: true,
              onSelect: vi.fn(),
              isDisabled: (row) => row.status === "disabled",
            },
          ],
        }}
      />,
    );

    /*
     * Named by the row, not reached by index. The id comes from `getRowId`, so
     * a test says which account it is acting on the same way an operator's
     * screen reader would — and stops depending on the order rows arrived in.
     */
    await user.click(screen.getByRole("button", { name: "Row actions for 1" }));
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));

    // The feature declared `onSelect: (row: DemoRow) => …` and gets a `DemoRow`
    // — the machinery erases the row type once, on the inside, not at the door.
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "1", name: "Sprocket" }),
    );
  });

  it("disables an action the row cannot take", async () => {
    const user = userEvent.setup();

    render(
      <Harness
        page={pageOf(demoRows)}
        meta={{
          rowActions: [
            {
              key: "delete",
              label: "Delete",
              destructive: true,
              onSelect: vi.fn(),
              isDisabled: (row) => row.status === "disabled",
            },
          ],
        }}
      />,
    );

    // Row 2 is the `disabled` one, so its delete is not offered.
    await user.click(screen.getByRole("button", { name: "Row actions for 2" }));

    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("names each row's menu by that row, not by its position", () => {
    render(
      <Harness
        page={pageOf(demoRows)}
        meta={{
          rowActions: [{ key: "edit", label: "Edit", onSelect: vi.fn() }],
        }}
      />,
    );

    // Twenty controls called "Row actions" is what the role-and-label
    // discipline exists to prevent (ADR-0036).
    expect(
      screen.getAllByRole("button", { name: /^Row actions for / }),
    ).toHaveLength(2);
  });

  it("renders no menu at all when a feature declares no actions", () => {
    render(<Harness page={pageOf(demoRows)} />);

    expect(
      screen.queryByRole("button", { name: /Row actions/ }),
    ).not.toBeInTheDocument();
  });
});

/**
 * Selection, capabilities and the toolbar (`D4.3`, ADR-0038).
 *
 * Driven from the demo config so what is under test is the *machinery* reading
 * a capability block, not a resource's opinion about itself — the same reason
 * `D3.6` proved the grid against a config that is nobody's real resource.
 */
describe("row selection", () => {
  it("has no checkbox column until a resource asks for one", () => {
    render(<Harness page={pageOf(demoRows)} />);

    // The safe default (ADR-0038 §Consequences): a resource that declares
    // nothing gets a plain read-only grid.
    expect(screen.queryByRole("checkbox", { name: /^Select/ })).toBeNull();
    expect(screen.getAllByRole("columnheader")).toHaveLength(6);
  });

  it("injects one when it does, named per row rather than per position", () => {
    render(<Harness page={pageOf(demoRows)} capabilities={ALL} />);

    // Seven headers: the six the config declares plus the built-in checkbox,
    // which `AppGrid` owns because it exists *because of* the capability.
    expect(screen.getAllByRole("columnheader")).toHaveLength(7);
    expect(
      screen.getByRole("checkbox", { name: "Select all rows on this page" }),
    ).toBeInTheDocument();
    // Named by the row's own id, the way `RowActions` is — twenty controls
    // called "Select row" is what the role-and-label discipline prevents.
    expect(
      screen.getByRole("checkbox", { name: "Select 1" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Select 2" }),
    ).toBeInTheDocument();
  });

  it("counts what is selected, and clears on demand", async () => {
    const user = userEvent.setup();

    render(<Harness page={pageOf(demoRows)} capabilities={ALL} />);

    await user.click(screen.getByRole("checkbox", { name: "Select 1" }));

    expect(screen.getByRole("checkbox", { name: "Select 1" })).toHaveAttribute(
      "data-state",
      "checked",
    );
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear selection" }));

    expect(screen.queryByText(/selected/)).toBeNull();
  });

  it("toggles the current page from the header checkbox", async () => {
    const user = userEvent.setup();

    render(<Harness page={pageOf(demoRows)} capabilities={ALL} />);

    await user.click(
      screen.getByRole("checkbox", { name: "Select all rows on this page" }),
    );

    /*
     * The page, and only the page — the scope manual pagination lets it honour
     * honestly. The client holds one server page, so a header checkbox claiming
     * "everything matching this filter" would claim a scope it cannot deliver
     * (ADR-0038 §Consequences).
     */
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select 1" })).toBeChecked();
  });

  it("keeps a selection made on one page while another page is in hand", async () => {
    const user = userEvent.setup();
    const second: readonly DemoRow[] = [
      { ...demoRows[0]!, id: "3", name: "Gasket" },
    ];

    const { rerender } = render(
      <Harness page={pageOf(demoRows, { total: 3 })} capabilities={ALL} />,
    );

    await user.click(screen.getByRole("checkbox", { name: "Select 1" }));
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    /*
     * The page changes under the grid, which is what a pager click does after
     * the refetch lands. Selection is keyed by `getRowId` — the resource's own
     * id — so it describes rows rather than positions and survives the swap.
     * A selection keyed by index would now be pointing at "Gasket".
     */
    rerender(
      <Harness
        page={pageOf(second, { total: 3, offset: 20 })}
        capabilities={ALL}
      />,
    );

    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "Select 3" }),
    ).not.toBeChecked();
  });
});

describe("the toolbar", () => {
  it("renders no region at all for a grid that is nothing but chrome", () => {
    /*
     * ADR-0038's empty-region rule, which `D4.5` came close to deleting by
     * accident: the Columns surface is in the toolbar on every grid, so the
     * only grid left without one is a grid with no movable columns. `AppGrid`
     * passes `null` rather than a component with an internal empty check,
     * because the toolbar decides on what it was *given* — and an element that
     * renders nothing still counts as given.
     */
    render(
      <Harness
        page={pageOf(demoRows)}
        overrides={{
          name: { hidden: true },
          status: { hidden: true },
          tags: { hidden: true },
          createdAt: { hidden: true },
          archivedAt: { hidden: true },
        }}
      />,
    );

    expect(screen.queryByRole("button", { name: "Columns" })).toBeNull();
    expect(document.querySelector('[data-slot="grid-toolbar"]')).toBeNull();
  });

  it("carries the Columns surface even when nothing else is configured", () => {
    render(<Harness page={pageOf(demoRows)} />);

    /*
     * ADR-0038's "a region with nothing in it renders nothing" still holds,
     * and since `D4.5` it has no live case on a grid that has columns:
     * ADR-0041 gave every such grid one control, so the toolbar always has
     * something in it. Asserted as what is true rather than deleted, because
     * the empty-region rule is still the reason a *future* control cannot
     * assume the region exists.
     */
    expect(screen.getByRole("button", { name: "Columns" })).toBeInTheDocument();
    expect(
      screen.queryByRole("searchbox", { name: "Search" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();
  });

  it("offers Create only when the capability says so", () => {
    const create = <button type="button">New widget</button>;

    const { rerender } = render(
      <Harness
        page={pageOf(demoRows)}
        capabilities={{ ...ALL, canCreate: false }}
        createAction={create}
      />,
    );

    expect(screen.queryByRole("button", { name: "New widget" })).toBeNull();

    rerender(
      <Harness
        page={pageOf(demoRows)}
        capabilities={ALL}
        createAction={create}
      />,
    );

    expect(
      screen.getByRole("button", { name: "New widget" }),
    ).toBeInTheDocument();
  });

  it("offers bulk delete only with the capability and a non-empty selection", async () => {
    const user = userEvent.setup();
    const onBulkDelete = vi.fn();

    render(
      <Harness
        page={pageOf(demoRows)}
        capabilities={ALL}
        onBulkDelete={onBulkDelete}
      />,
    );

    // Nothing staged, nothing to act on.
    expect(screen.queryByRole("button", { name: /^Delete/ })).toBeNull();

    await user.click(screen.getByRole("checkbox", { name: "Select 2" }));
    await user.click(screen.getByRole("button", { name: "Delete 1" }));

    // Resource ids, and the context that lets the caller end the selection when
    // the fan-out settles (the `D4.3` amendment to ADR-0038's signature).
    expect(onBulkDelete).toHaveBeenCalledWith(
      ["2"],
      expect.objectContaining({ selectedIds: ["2"] }),
    );
  });

  it("withholds bulk delete when the resource declares no bulk capability", async () => {
    const user = userEvent.setup();

    render(
      <Harness
        page={pageOf(demoRows)}
        capabilities={{ ...ALL, canBulkDelete: false }}
        onBulkDelete={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "Select 2" }));

    // Still selectable, still counted — the button is what the capability
    // removed, and the two are separate flags on purpose.
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Delete/ })).toBeNull();
  });

  it("composes the slots around the defaults", () => {
    render(
      <Harness
        page={pageOf(demoRows)}
        searchable
        capabilities={ALL}
        toolbarStart={<span>extra left</span>}
        toolbarEnd={<span>extra right</span>}
      />,
    );

    expect(
      screen.getByRole("searchbox", { name: "Search" }),
    ).toBeInTheDocument();
    expect(screen.getByText("extra left")).toBeInTheDocument();
    expect(screen.getByText("extra right")).toBeInTheDocument();
  });

  it("lets renderToolbar replace the region, slots and all", () => {
    render(
      <Harness
        page={pageOf(demoRows)}
        searchable
        capabilities={ALL}
        createAction={<button type="button">New widget</button>}
        toolbarStart={<span>extra left</span>}
        renderToolbar={({ selectedIds }) => (
          <div>bespoke ({selectedIds.length})</div>
        )}
      />,
    );

    // Precedence is pinned: `renderToolbar` wins and the slots are then
    // ignored. Composing the two would make "what is in this toolbar" a
    // question with two answers.
    expect(screen.getByText("bespoke (0)")).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "New widget" })).toBeNull();
    expect(screen.queryByText("extra left")).toBeNull();
  });
});
