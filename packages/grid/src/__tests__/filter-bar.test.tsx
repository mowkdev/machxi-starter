import type { HotFilterConfig } from "@repo/resource";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  Harness,
  base,
  openFilterDialog,
  pageOf,
} from "./support/demo-harness";
import { demoRows } from "./support/demo-resource";

/**
 * What the grid says it is filtered by: the applied-filters bar, and the hot
 * filters that write the same URL entries (ADR-0039, ADR-0052 §Visible state).
 *
 * **Moved from the admin at `D22.3`** (ADR-0077 §4), out of
 * `shared/grid/__tests__/app-grid.test.tsx`, with its assertions unchanged.
 */

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
      // Carried through untouched: "clear all" clears what is *listed*, and
      // whether the endpoint counts is not one of those things (ADR-0060 §2).
      count: true,
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

  it("chips what it is displaying as well as what it cannot", () => {
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

    /*
     * **Reversed at `D10.2`** (ADR-0052 §Visible state). ADR-0039 suppressed
     * this chip because the pressed button already was the filter's visible,
     * removable representation; the operator's call is that the bar is the
     * inventory and an inventory with an exception is read twice. So both are
     * on screen, and both remove the same entry.
     */
    expect(screen.getByText("Status is Disabled")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disabled" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
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
     * This used to be the suppression rule's dangerous edge: `renderToolbar`
     * replaces the region outright — hot filters included — so a bar that
     * suppressed the chip would have left the filter displayed by *nothing*.
     * Since `D10.2` no chip is ever suppressed, so the case can no longer fail
     * that way; it is kept because the *extension seam* is still real, and a
     * grid whose toolbar was replaced must still say what it is filtered by.
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
