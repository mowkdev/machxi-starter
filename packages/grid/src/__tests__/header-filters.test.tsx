import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
 * A filterable column's header dialog, driven from the demo config (ADR-0039).
 *
 * **Moved from the admin at `D22.3`** (ADR-0077 §4), out of
 * `shared/grid/__tests__/app-grid.test.tsx`, with its assertions unchanged.
 */

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
