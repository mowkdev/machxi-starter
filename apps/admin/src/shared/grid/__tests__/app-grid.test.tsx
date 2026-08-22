import {
  listQuerySearchSchema,
  type ListQuerySearch,
  type Page,
} from "@repo/contracts";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ColumnOverrides,
  GridCapabilities,
  HotFilterConfig,
} from "@/shared/resource/types";
import {
  demoResourceConfig,
  demoRows,
  type DemoRow,
} from "@/test/fixtures/demo-resource";

import { createTestI18n } from "@/test/render";

import { AppGrid } from "../app-grid";
import {
  createMemoryStorage,
  gridStorageKey,
  type PreferenceStorage,
} from "../preferences";
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
  hotFilters,
  overrides,
  gridId,
  storage,
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
  readonly hotFilters?: readonly HotFilterConfig[];
  readonly overrides?: ColumnOverrides;
  readonly gridId?: string;
  readonly storage?: PreferenceStorage;
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
  /*
   * The grid's chrome speaks keys since `D7.2`, so the harness mounts an
   * instance of its own — `en`, loaded synchronously, which is why every
   * assertion in this file is still by the English accessible name it was
   * written with (ADR-0046 §14). One per mounted harness, from the same factory
   * the app uses, so no case inherits another's language.
   */
  const [i18n] = useState(createTestI18n);

  return (
    <I18nextProvider i18n={i18n.instance}>
      <AppGrid<DemoRow>
        columns={demoResourceConfig.columns}
        overrides={overrides}
        page={page}
        listState={listState}
        searchable={searchable}
        hotFilters={hotFilters}
        gridId={gridId}
        preferenceStorage={storage}
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
    </I18nextProvider>
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

/**
 * Opens one column's filter dialog and hands back its scope.
 *
 * The name is matched by prefix because the icon carries its active state in
 * its accessible name — "Filter by Name" when clear, "Filter by Name
 * (filtered)" when the URL says otherwise — which is the one thing a screen
 * reader can hear about a column that is already narrowing the list.
 */
const openFilterDialog = async (
  user: ReturnType<typeof userEvent.setup>,
  column: string,
) => {
  await user.click(
    screen.getByRole("button", { name: new RegExp(`^Filter by ${column}`) }),
  );

  return within(await screen.findByRole("dialog"));
};

describe("the header filter dialogs", () => {
  it("leaves nothing in the header but headers", () => {
    render(<Harness page={pageOf(demoRows)} />);

    /*
     * The filter row is gone (ADR-0039) — one header row, not two — which is
     * what returns the `dateRange` columns to content width and is the concrete
     * complaint the ADR opens on. Asserted from the operator's side as well:
     * none of the four controls is on screen until something is opened.
     */
    // The `thead` is the first `rowgroup`, and it holds one row where it used
    // to hold two.
    expect(
      within(screen.getAllByRole("rowgroup")[0]!).getAllByRole("row"),
    ).toHaveLength(1);
    expect(
      screen.queryByRole("textbox", { name: "Filter by Name" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Filter by Status" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "Show archived" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Created from")).not.toBeInTheDocument();
  });

  it("offers a filter icon only where the config declares one", () => {
    render(<Harness page={pageOf(demoRows)} />);

    for (const column of ["Name", "Status", "Created", "Archived"])
      expect(
        screen.getByRole("button", { name: `Filter by ${column}` }),
      ).toBeInTheDocument();

    // `tags` declares no filter, because nothing allow-lists it.
    expect(
      screen.queryByRole("button", { name: "Filter by Tags" }),
    ).not.toBeInTheDocument();
  });

  it("commits an escaped containment filter on Apply, and not before", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<Harness page={pageOf(demoRows)} onChange={onChange} />);

    const dialog = await openFilterDialog(user, "Name");

    await user.type(
      dialog.getByRole("textbox", { name: "Filter by Name" }),
      "100%",
    );

    /*
     * The whole point of a composition surface: four keystrokes, no navigation.
     * The row this replaced debounced and then committed anyway, which is what
     * made a half-typed date range a real request.
     */
    expect(onChange).not.toHaveBeenCalled();

    await user.click(dialog.getByRole("button", { name: "Apply" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        // Escaped: somebody typing `100%` means the four characters, not
        // "match everything" (ADR-0014's reasoning, applied client-side).
        filters: [{ field: "name", op: "like", value: "%100\\%%" }],
      }),
    );
  });

  it("seeds its draft from the URL, and says so in the icon's name", async () => {
    const user = userEvent.setup();

    render(
      <Harness
        page={pageOf(demoRows)}
        initial={{
          ...base,
          filters: [{ field: "name", op: "like", value: "%ada%" }],
        }}
      />,
    );

    // The state a screen reader can reach, not only an accent colour.
    expect(
      screen.getByRole("button", { name: "Filter by Name (filtered)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Filter by Status" }),
    ).toBeInTheDocument();

    const dialog = await openFilterDialog(user, "Name");

    // What the operator typed, not the wire pattern — a pasted link opens the
    // same dialog state as the session that produced it.
    expect(dialog.getByRole("textbox", { name: "Filter by Name" })).toHaveValue(
      "ada",
    );
  });

  it("gives focus back to the icon it was opened from", async () => {
    const user = userEvent.setup();

    render(<Harness page={pageOf(demoRows)} />);

    const trigger = screen.getByRole("button", { name: "Filter by Name" });

    await user.click(trigger);
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");

    /*
     * The reason the icon is a real `DialogTrigger` and not a `Button` with an
     * `onClick`. Radix's modal content replaces the default focus restore with
     * `triggerRef.current?.focus()`; with no Trigger mounted that ref is null,
     * the restore is *suppressed* rather than falling back, and every close
     * path drops focus onto `<body>` — a keyboard operator ejected to the top
     * of the page by the act of filtering one column. Nothing in a class list
     * or a type says so, which is why it is asserted.
     */
    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
  });

  it("clears its own column and leaves every other filter alone", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <Harness
        page={pageOf(demoRows)}
        onChange={onChange}
        initial={{
          ...base,
          filters: [
            { field: "name", op: "like", value: "%ada%" },
            { field: "status", op: "eq", value: "active" },
          ],
        }}
      />,
    );

    const dialog = await openFilterDialog(user, "Name");

    await user.click(dialog.getByRole("button", { name: "Clear" }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [{ field: "status", op: "eq", value: "active" }],
      }),
    );
  });

  it("writes both bounds of a range as one navigation", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<Harness page={pageOf(demoRows)} onChange={onChange} />);

    const dialog = await openFilterDialog(user, "Created");

    /*
     * `fireEvent` rather than `user.type`: jsdom's date input takes a value,
     * not keystrokes. What is under test is the commit, not the widget.
     */
    fireEvent.change(dialog.getByLabelText("Created from"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.change(dialog.getByLabelText("Created to"), {
      target: { value: "2026-02-01" },
    });

    expect(onChange).not.toHaveBeenCalled();

    await user.click(dialog.getByRole("button", { name: "Apply" }));

    // One navigation carrying both halves of one intent — and the upper bound
    // pushed to the end of the chosen day, because "up to the 1st" includes it.
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [
          {
            field: "createdAt",
            op: "gte",
            value: new Date("2026-01-01T00:00:00.000Z"),
          },
          {
            field: "createdAt",
            op: "lte",
            value: new Date("2026-02-01T23:59:59.999Z"),
          },
        ],
      }),
    );
  });

  it("writes a presence filter from its checkbox", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<Harness page={pageOf(demoRows)} onChange={onChange} />);

    const dialog = await openFilterDialog(user, "Archived");

    await user.click(dialog.getByRole("checkbox", { name: "Show archived" }));
    await user.click(dialog.getByRole("button", { name: "Apply" }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [{ field: "archivedAt", op: "null", value: false }],
      }),
    );
  });

  it("round-trips the enum control", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<Harness page={pageOf(demoRows)} onChange={onChange} />);

    const dialog = await openFilterDialog(user, "Status");

    await user.click(
      dialog.getByRole("combobox", { name: "Filter by Status" }),
    );
    await user.click(await screen.findByRole("option", { name: "Disabled" }));
    await user.click(dialog.getByRole("button", { name: "Apply" }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [{ field: "status", op: "eq", value: "disabled" }],
      }),
    );
  });
});

describe("the applied-filters bar", () => {
  it("renders nothing when nothing is applied", () => {
    render(<Harness page={pageOf(demoRows)} />);

    expect(
      screen.queryByRole("button", { name: "Clear all" }),
    ).not.toBeInTheDocument();
    /*
     * The live region is *mounted* and empty rather than absent. A region that
     * appears already populated is announced unreliably and one that unmounts
     * is not announced at all — so clearing the last filter, the change most
     * worth hearing, would be the one the bar stayed silent about.
     */
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("names an owned filter in the column's own words, and removes only it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <Harness
        page={pageOf(demoRows)}
        onChange={onChange}
        initial={{
          ...base,
          q: "ada",
          filters: [
            { field: "name", op: "like", value: "%ada%" },
            { field: "status", op: "eq", value: "active" },
          ],
        }}
      />,
    );

    /*
     * The column config contributes the *words* — its header, and the enum's
     * humanised option label — and never membership. The `like` pattern is
     * unwrapped back to what was typed for the same reason the dialog unwraps
     * it: `%ada%` is the wire's business.
     */
    expect(screen.getByText("Name contains “ada”")).toBeInTheDocument();
    expect(screen.getByText("Status is Active")).toBeInTheDocument();
    expect(screen.getByText("Search “ada”")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("3 filters applied");

    await user.click(
      screen.getByRole("button", { name: "Remove filter: Status is Active" }),
    );

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        q: "ada",
        filters: [{ field: "name", op: "like", value: "%ada%" }],
      }),
    );
  });

  it("shows a filter no column owns, and clears it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <Harness
        page={pageOf(demoRows)}
        onChange={onChange}
        initial={{
          ...base,
          filters: [{ field: "ownerId", op: "eq", value: "u-9" }],
        }}
      />,
    );

    /*
     * The case the bar exists for, and the one the old filter row answered with
     * *nothing on screen at all*: a deep link narrowing the list on a field no
     * column declares. The label is deliberately ugly — it is showing the
     * operator something no config claimed to understand — and it is removable
     * all the same.
     */
    expect(screen.getByText("ownerId eq u-9")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Remove filter: ownerId eq u-9" }),
    );

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ filters: [] }),
    );
  });

  it("clears filters and q, resets the offset, and leaves sort and limit alone", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <Harness
        page={pageOf(demoRows, { total: 200 })}
        onChange={onChange}
        initial={{
          ...base,
          offset: 100,
          limit: 50,
          sort: [{ field: "name", direction: "asc" }],
          q: "ada",
          filters: [{ field: "status", op: "eq", value: "active" }],
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Clear all" }));

    // What is *listed* changed, so the page resets; how it is ordered and how
    // much of it fits did not, and neither was asked about.
    expect(onChange).toHaveBeenCalledWith({
      offset: 0,
      limit: 50,
      sort: [{ field: "name", direction: "asc" }],
      filters: [],
    });
  });
});

describe("hot filters", () => {
  const STATUS_GROUP: readonly HotFilterConfig[] = [
    {
      kind: "enum",
      field: "status",
      label: "demo:columns.status",
      op: "eq",
      options: ["active", "disabled"],
    },
  ];

  it("renders a declared group, and presses on and off", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <Harness
        page={pageOf(demoRows)}
        onChange={onChange}
        hotFilters={STATUS_GROUP}
      />,
    );

    const group = within(screen.getByRole("group", { name: "Status filter" }));

    expect(group.getByRole("button", { name: "Active" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await user.click(group.getByRole("button", { name: "Active" }));

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: [{ field: "status", op: "eq", value: "active" }],
      }),
    );
    expect(screen.getByRole("button", { name: "Active" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Pressing the pressed option releases it — the implicit "All" that makes a
    // single-select stance clearable without a second control.
    await user.click(screen.getByRole("button", { name: "Active" }));

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ filters: [] }),
    );
  });

  it("agrees with the same field's header dialog", async () => {
    const user = userEvent.setup();

    render(
      <Harness
        page={pageOf(demoRows)}
        hotFilters={STATUS_GROUP}
        initial={{
          ...base,
          filters: [{ field: "status", op: "eq", value: "disabled" }],
        }}
      />,
    );

    /*
     * Two views of one entry, never two states. Both read the URL, so a value
     * set by either is what the other shows — which is the property that makes
     * a hot filter a third *writer* rather than a second mechanism.
     */
    expect(screen.getByRole("button", { name: "Disabled" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const dialog = await openFilterDialog(user, "Status");

    expect(
      dialog.getByRole("combobox", { name: "Filter by Status" }),
    ).toHaveTextContent("Disabled");
  });

  it("suppresses the chip it is displaying, and not one it cannot", () => {
    const displayed = render(
      <Harness
        page={pageOf(demoRows)}
        hotFilters={STATUS_GROUP}
        initial={{
          ...base,
          filters: [{ field: "status", op: "eq", value: "disabled" }],
        }}
      />,
    );

    // The pressed button *is* this filter's visible, removable representation;
    // a chip beside it would be a second way to remove one thing.
    expect(screen.queryByText("Status is Disabled")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear all" }),
    ).toBeInTheDocument();

    /*
     * Unmounted rather than re-rendered: `Harness` seeds the route's search
     * params into state once, the way a route does, so a new `initial` on a
     * standing tree would be ignored — which would make the second half of this
     * test assert the first half's DOM.
     */
    displayed.unmount();

    render(
      <Harness
        page={pageOf(demoRows)}
        hotFilters={STATUS_GROUP}
        initial={{
          ...base,
          filters: [{ field: "status", op: "eq", value: "archived" }],
        }}
      />,
    );

    /*
     * A value the group cannot represent — a deep link outside the declared
     * options. Nothing is pressed, so nothing is displaying it, so the chip is
     * the only thing standing between the operator and an unexplained list.
     */
    expect(screen.getByRole("button", { name: "Active" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByText("Status is archived")).toBeInTheDocument();
  });

  it("keeps the chip when the toolbar that would have displayed it was replaced", () => {
    render(
      <Harness
        page={pageOf(demoRows)}
        hotFilters={STATUS_GROUP}
        renderToolbar={() => <div>bespoke</div>}
        initial={{
          ...base,
          filters: [{ field: "status", op: "eq", value: "disabled" }],
        }}
      />,
    );

    /*
     * `renderToolbar` replaces the region outright — hot filters included — so
     * suppressing this chip would leave the filter displayed by *nothing*: the
     * silently-narrower grid the bar exists to prevent, arriving through the
     * extension seam.
     */
    expect(screen.getByText("bespoke")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Disabled" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Status is Disabled")).toBeInTheDocument();
  });

  it("is released by Clear all, because a hot filter is a filter", async () => {
    const user = userEvent.setup();

    render(
      <Harness
        page={pageOf(demoRows)}
        hotFilters={STATUS_GROUP}
        initial={{
          ...base,
          filters: [{ field: "status", op: "eq", value: "active" }],
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Active" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Clear all" }));

    expect(screen.getByRole("button", { name: "Active" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(
      screen.queryByRole("button", { name: "Clear all" }),
    ).not.toBeInTheDocument();
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
    JSON.parse(storage.read(gridStorageKey(GRID)) ?? "null") as Record<
      string,
      unknown
    > | null;

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
