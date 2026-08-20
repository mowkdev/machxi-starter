import {
  listQuerySearchSchema,
  type ListQuerySearch,
  type Page,
} from "@repo/contracts";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { GridCapabilities } from "@/shared/resource/types";
import {
  demoResourceConfig,
  demoRows,
  type DemoRow,
} from "@/test/fixtures/demo-resource";

import { AppGrid } from "../app-grid";
import type { GridMeta, GridToolbarContext } from "../types";

/**
 * The grid, rendered entirely from the demo config (ADR-0035, `D3.6`).
 *
 * User-centric per ADR-0036: query by role and accessible name, drive with
 * `user-event`, assert what an operator sees. The role queries work directly
 * because the grid renders a real semantic `<table>` — the accessibility
 * posture and the testing posture are the same posture.
 */

const base = listQuerySearchSchema.parse({});

const pageOf = (
  rows: readonly DemoRow[],
  overrides: Partial<Page<DemoRow>> = {},
): Page<DemoRow> => ({
  items: rows,
  total: rows.length,
  offset: 0,
  limit: 20,
  sort: [],
  filters: {},
  ...overrides,
});

/**
 * The grid with its state where the app keeps it.
 *
 * The URL is the state (ADR-0034), so a test that held it anywhere else would
 * be testing a different component. `onChange` is the spy; the state below
 * stands in for the route's search params.
 */
const Harness = ({
  page,
  initial = base,
  meta,
  onChange,
  searchable = false,
  capabilities,
  createAction,
  onBulkDelete,
  toolbarStart,
  toolbarEnd,
  renderToolbar,
}: {
  readonly page?: Page<DemoRow>;
  readonly initial?: ListQuerySearch;
  readonly meta?: GridMeta<DemoRow>;
  readonly onChange?: (next: ListQuerySearch) => void;
  readonly searchable?: boolean;
  readonly capabilities?: GridCapabilities;
  readonly createAction?: ReactNode;
  readonly onBulkDelete?: (
    ids: readonly string[],
    context: GridToolbarContext,
  ) => void;
  readonly toolbarStart?: ReactNode;
  readonly toolbarEnd?: ReactNode;
  readonly renderToolbar?: (context: GridToolbarContext) => ReactNode;
}) => {
  const [listState, setListState] = useState(initial);

  return (
    <AppGrid<DemoRow>
      columns={demoResourceConfig.columns}
      page={page}
      listState={listState}
      searchable={searchable}
      meta={meta}
      capabilities={capabilities}
      createAction={createAction}
      onBulkDelete={onBulkDelete}
      toolbarStart={toolbarStart}
      toolbarEnd={toolbarEnd}
      renderToolbar={renderToolbar}
      getRowId={(row) => row.id}
      onListStateChange={(next) => {
        setListState(next);
        onChange?.(next);
      }}
    />
  );
};

/** Every affordance on, for the tests that are about what a *role* removes. */
const ALL: GridCapabilities = {
  selectable: true,
  canCreate: true,
  canEdit: true,
  canDelete: true,
  canBulkDelete: true,
};

describe("AppGrid", () => {
  it("renders a themed, semantic table entirely from config", () => {
    render(<Harness page={pageOf(demoRows)} />);

    const table = screen.getByRole("table");

    // Headers come from the config's `header`, in declaration order.
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Name", "Status", "Tags", "Created", "Archived", "Actions"]);

    expect(screen.getByText("Sprocket")).toBeInTheDocument();
    // `statusBadge` and `rolesList` resolved from their keys.
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getAllByText("Alpha").length).toBeGreaterThan(0);
    // The `date` formatter ran; the raw ISO string never reaches the screen.
    expect(
      screen.queryByText("2026-01-15T10:00:00.000Z"),
    ).not.toBeInTheDocument();
    // A null value is a dash, not a blank.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("offers a sort control only where the config allows one", () => {
    render(<Harness page={pageOf(demoRows)} />);

    expect(screen.getByRole("button", { name: "Name" })).toBeInTheDocument();
    // `tags` is not sortable in the config, so there is nothing to click.
    expect(
      screen.queryByRole("button", { name: "Tags" }),
    ).not.toBeInTheDocument();
  });

  it("reports a header click as a state change instead of reordering the page", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const rows = [...demoRows];

    render(<Harness page={pageOf(rows)} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Name" }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ sort: [{ field: "name", direction: "asc" }] }),
    );

    /*
     * The honesty the manual flags exist for: the engine did not sort the rows
     * it holds. `Sprocket` is still first because the *server* has not been
     * asked yet — a grid that reordered here would be implying it had sorted
     * the dataset when it had only touched one page.
     */
    const [, body] = screen.getAllByRole("rowgroup");
    expect(within(body!).getAllByRole("row")[0]).toHaveTextContent("Sprocket");
  });

  it("marks the sorted column for assistive technology", async () => {
    const user = userEvent.setup();

    render(<Harness page={pageOf(demoRows)} />);

    await user.click(screen.getByRole("button", { name: "Name" }));

    await waitFor(() => {
      expect(
        screen.getByRole("columnheader", { name: /Name/ }),
      ).toHaveAttribute("aria-sort", "ascending");
    });
  });
});

describe("the pager", () => {
  it("says where the operator is, out of a real total", () => {
    render(
      <Harness
        page={pageOf(demoRows, { total: 143, offset: 20, limit: 20 })}
        initial={{ ...base, offset: 20 }}
      />,
    );

    expect(screen.getByText("21–22 of 143")).toBeInTheDocument();
  });

  it("disables the ends it is already at", () => {
    render(<Harness page={pageOf(demoRows, { total: 2 })} />);

    expect(screen.getByRole("button", { name: "First page" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Previous page" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Last page" })).toBeDisabled();
  });

  it("jumps to the last page from a real total", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <Harness page={pageOf(demoRows, { total: 143 })} onChange={onChange} />,
    );

    await user.click(screen.getByRole("button", { name: "Last page" }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 140 }),
    );
  });

  it("is open-ended when the endpoint did not count", () => {
    /*
     * `total: null` is reserved for endpoints that opt out of `count(*)`
     * (ADR-0014). None do today, which is exactly why the branch is written
     * now: a pager that assumed a number would render `NaN` the day one does.
     */
    const rows = Array.from({ length: 20 }, (_, index) => ({
      ...demoRows[0]!,
      id: String(index),
    }));

    render(<Harness page={pageOf(rows, { total: null })} />);

    expect(screen.getByText("1–20")).toBeInTheDocument();
    expect(screen.queryByText(/ of /)).not.toBeInTheDocument();
    // There is no last page to reach, so the control says so.
    expect(screen.getByRole("button", { name: "Last page" })).toBeDisabled();
    // A full page is the only evidence that more exists.
    expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();
  });

  it("keeps the operator near their place when the page size changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <Harness
        page={pageOf(demoRows, { total: 143, offset: 60 })}
        initial={{ ...base, offset: 60 }}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Rows per page" }));
    await user.click(screen.getByRole("option", { name: "50" }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50, offset: 50 }),
    );
  });

  it("rescues a stranded offset instead of showing an empty grid", async () => {
    /*
     * Deletions shrank the dataset below the page the operator is on: the API
     * answers an empty `items` with the true `total`, and without the rescue
     * they are left staring at a blank grid that looks exactly like
     * "everything is gone".
     */
    const onChange = vi.fn();

    render(
      <Harness
        page={pageOf([], { total: 45, offset: 60 })}
        initial={{ ...base, offset: 60 }}
        onChange={onChange}
      />,
    );

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 40 }),
      );
    });
  });

  it("leaves a genuinely empty dataset alone", () => {
    const onChange = vi.fn();

    render(<Harness page={pageOf([], { total: 0 })} onChange={onChange} />);

    expect(screen.getByText("No results.")).toBeInTheDocument();
    expect(screen.getByText("No results")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("the filter row", () => {
  it("offers a control only where the config declares one", () => {
    render(<Harness page={pageOf(demoRows)} />);

    expect(
      screen.getByRole("textbox", { name: "Filter by Name" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Filter by Status" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Show archived" }),
    ).toBeInTheDocument();
    // `tags` declares no filter, because nothing allow-lists it.
    expect(
      screen.queryByRole("textbox", { name: "Filter by Tags" }),
    ).not.toBeInTheDocument();
  });

  it("writes an escaped containment filter after the operator stops typing", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<Harness page={pageOf(demoRows)} onChange={onChange} />);

    await user.type(
      screen.getByRole("textbox", { name: "Filter by Name" }),
      "100%",
    );

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          filters: [{ field: "name", op: "like", value: "%100\\%%" }],
        }),
      );
    });

    // Debounced: one navigation for the whole word, not one per keystroke.
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("writes a presence filter from the checkbox", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<Harness page={pageOf(demoRows)} onChange={onChange} />);

    await user.click(screen.getByRole("checkbox", { name: "Show archived" }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [{ field: "archivedAt", op: "null", value: false }],
      }),
    );
  });

  it("renders the controls from the URL it was given", () => {
    render(
      <Harness
        page={pageOf(demoRows)}
        initial={{
          ...base,
          filters: [{ field: "name", op: "like", value: "%ada%" }],
        }}
      />,
    );

    // What the operator typed, not the wire pattern — a pasted link renders the
    // same control state as the session that produced it.
    expect(screen.getByRole("textbox", { name: "Filter by Name" })).toHaveValue(
      "ada",
    );
  });
});

describe("search", () => {
  it("appears only where the endpoint is searchable", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    const { rerender } = render(<Harness page={pageOf(demoRows)} />);

    expect(
      screen.queryByRole("searchbox", { name: "Search" }),
    ).not.toBeInTheDocument();

    rerender(
      <Harness page={pageOf(demoRows)} searchable onChange={onChange} />,
    );

    await user.type(screen.getByRole("searchbox", { name: "Search" }), "ada");

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ q: "ada" }),
      );
    });
  });
});

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
  it("renders nothing at all when there is nothing to put in it", () => {
    const { container } = render(<Harness page={pageOf(demoRows)} />);

    expect(container.querySelector('[data-slot="grid-toolbar"]')).toBeNull();
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

describe("loading", () => {
  it("holds the table's shape rather than collapsing to nothing", () => {
    render(<Harness />);

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(6);
    expect(screen.queryByText("Sprocket")).not.toBeInTheDocument();
  });
});

/**
 * The frame the grid renders into (`D4.1`, ADR-0037).
 *
 * Nothing here asserts geometry, and it says so rather than pretending: jsdom
 * computes no layout, so "the header stayed put while the rows scrolled" is a
 * claim only the deliverable's manual walk can make. What this suite pins is
 * the *structure* that produces it — which element scrolls, that there is
 * exactly one of it, and that the header and the pager are its static siblings
 * rather than its content. Those are the invariants a careless wrapper breaks,
 * and they are exactly what ADR-0037 §Consequences asks a review to cite.
 */
describe("viewport layout", () => {
  /*
   * By its `data-slot`, not by its utility classes: renaming a Tailwind class
   * should not fail a suite that is asking "which element scrolls". The class
   * *assertions* below are a different question — which axes and what floor —
   * and those genuinely are about the classes.
   */
  const scrollBody = (container: HTMLElement) =>
    container.querySelector('[data-slot="grid-scroll"]');

  it("puts the table in exactly one scroll container, and owns it", () => {
    const { container } = render(<Harness page={pageOf(demoRows)} />);

    // The doubled wrapper is gone: `@repo/ui`'s Table no longer contributes
    // one, so the border's radius has nothing clipping it and sticky offsets
    // have one element to resolve against.
    expect(
      container.querySelectorAll('[data-slot="table-container"]'),
    ).toHaveLength(0);

    const body = scrollBody(container);
    expect(body).not.toBeNull();
    expect(container.querySelectorAll(".overflow-auto")).toHaveLength(1);
    expect(body).toContainElement(screen.getByRole("table"));
  });

  it("scrolls on both axes, with the design system's own scrollbar", () => {
    const { container } = render(<Harness page={pageOf(demoRows)} />);

    // `overflow-auto`, not `overflow-x-auto`: the vertical scroll the height
    // budget hands it and the horizontal scroll the double wrapper used to
    // split are the same container's job now.
    const body = scrollBody(container);
    expect(body?.className).toContain("scrollbar-thin");
    expect(body?.className).toContain("min-h-64");
  });

  it("keeps the header inside the scroll body and stuck to its top", () => {
    const { container } = render(<Harness page={pageOf(demoRows)} />);

    const header = container.querySelector('[data-slot="table-header"]');
    expect(scrollBody(container)).toContainElement(header as HTMLElement);
    expect(header?.className).toContain("sticky");
    /*
     * Opaque on the *cells*, and the table drawn with separated borders — the
     * shape ADR-0037 (amended D4.1) settled on after the browser showed that a
     * background on the `thead` does not travel with a sticky section while
     * `border-collapse: collapse` is in force. Asserted because it looks like
     * gratuitous class soup at a glance and is not; the ADR says why.
     */
    expect(header?.className).toContain("[&_th]:bg-card");
    expect(screen.getByRole("table").className).toContain("border-separate");
  });

  it("keeps the search box and the pager out of it", () => {
    const { container } = render(
      <Harness page={pageOf(demoRows)} searchable />,
    );

    // Static siblings of the scroll body: the chrome declares its height and
    // the rows take the rest, which is the whole budget in one assertion.
    const body = scrollBody(container);
    expect(body).not.toContainElement(
      screen.getByRole("navigation", { name: "Pagination" }),
    );
    expect(body).not.toContainElement(
      screen.getByRole("searchbox", { name: "Search" }),
    );
  });
});
